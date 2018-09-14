'use strict';

const path = require('path');
const is = require('is-type-of');

module.exports = {
  /**
   * load app.js/agent.js if it's a boot class
   * 加载app.js或者agent.js文件
   */
  loadBootHook() {
    // bootFileName: return this.app.type === 'application' ? 'app' : 'agent';
    const fileName = this.bootFileName;
    this.timing.start(`Load boot/${fileName}.js`);
    // 循环每一个加载单元
    for (const unit of this.getLoadUnits()) {
      const bootFilePath = this.resolveModule(path.join(unit.path, fileName));
      if (!bootFilePath) {
        continue;
      }
      const bootHook = this.requireFile(bootFilePath);
      // if is boot class, add to lifecycle
      if (is.class(bootHook)) {
        this.lifecycle.addBootHook(bootHook);
      }
    }
    // init boots
    this.lifecycle.init();
    this.timing.end(`Load boot/${fileName}.js`);
  },
};
