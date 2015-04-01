var lastInstance;

var SimpleTick = module.exports = function SimpleTick(prefix, options) {
    lastInstance && (lastInstance.clear() && (lastInstance = null))

    this.options = options = options || {keepAlive: false};
    this.stream = options.stream || process.stderr;

    this.prefix = prefix;
    this.tokens = options.tokens || '|/-\\'.split('');
    this.count = 0;
    this.tick();
    this.timer = null;
    lastInstance = this;
};

SimpleTick.prototype.render = function() {
    var len = this.tokens.length;
    var str = this.prefix + this.tokens[this.count%len] + ' ';

    if (str !== this.lastDraw) {
        this.stream.clearLine();
        this.stream.cursorTo(0);
        this.stream.write(str);
        this.lastDraw = str;
    }

};

SimpleTick.prototype.tick = function() {
    if (this._cleared) {
        return;
    }

    this.render();
    this.count++;

    if (this.options.keepAlive) {
        clearTimeout(this.timer);
        this.timer = setTimeout(this.tick.bind(this), this.options.interval || 100);
    }
};

SimpleTick.prototype.clear = function() {
    clearTimeout(this.timer);
    this._cleared = true;
    lastInstance = null;
    this.stream.clearLine();
    this.stream.cursorTo(0);
}
