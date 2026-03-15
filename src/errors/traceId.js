let _counter = 0;

function generateTraceId() {
    _counter = (_counter + 1) % 1000000;
    return `${Date.now().toString(36)}-${_counter.toString(36).padStart(4, '0')}`;
}

module.exports = { generateTraceId };
