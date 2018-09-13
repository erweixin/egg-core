'use strict';

const path = require('path');


module.exports = {

  /**
   * Load app/router.js
   * 加载根目录下app/router文件。router文件exports的是function的话将会直接以this.app为参数运行该文件。
   * @method EggLoader#loadRouter
   * @param {Object} opt - LoaderOptions
   * @since 1.0.0
   */
  loadRouter() {
    this.timing.start('Load Router');
    // 加载 router.js
    this.loadFile(this.resolveModule(path.join(this.options.baseDir, 'app/router')));
    this.timing.end('Load Router');
  },
};
