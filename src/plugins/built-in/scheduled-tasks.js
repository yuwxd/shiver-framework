const name = 'scheduled-tasks';

async function init(framework, options = {}) {
    const tasks = new Map();

    const schedule = (taskName, intervalMs, fn, runImmediately = false) => {
        if (tasks.has(taskName)) clearInterval(tasks.get(taskName).timer);
        const timer = setInterval(async () => {
            try {
                await fn(framework);
            } catch (err) {
                console.error(`[scheduled-tasks] Error in task "${taskName}":`, err?.message);
            }
        }, intervalMs);
        if (timer.unref) timer.unref();
        tasks.set(taskName, { timer, intervalMs, fn });

        if (runImmediately) {
            fn(framework).catch(err => console.error(`[scheduled-tasks] Error in task "${taskName}":`, err?.message));
        }
    };

    const cancel = (taskName) => {
        if (tasks.has(taskName)) {
            clearInterval(tasks.get(taskName).timer);
            tasks.delete(taskName);
        }
    };

    const cancelAll = () => {
        for (const [, { timer }] of tasks) clearInterval(timer);
        tasks.clear();
    };

    const scheduler = { schedule, cancel, cancelAll, getTasks: () => [...tasks.keys()] };

    if (options.tasks) {
        for (const task of options.tasks) {
            schedule(task.name, task.intervalMs, task.fn, task.runImmediately);
        }
    }

    framework.container.set('scheduler', scheduler);
    framework.scheduler = scheduler;
    framework.onShutdown(() => cancelAll());
}

module.exports = { name, init };
