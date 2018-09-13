'use strict';

const path = require('path');


module.exports = {

  /**
   * Load app/service
   * @method EggLoader#loadService
   * @param {Object} opt - LoaderOptions
   * @since 1.0.0
   */
  loadService(opt) {
    this.timing.start('Load Service');
    // 将各个加载单元app/service目录下的文件exports出的载入到 app.serviceClasses、app.ctx.service
    opt = Object.assign({
      call: true,
      caseStyle: 'lower',
      fieldClass: 'serviceClasses',
      directory: this.getLoadUnits().map(unit => path.join(unit.path, 'app/service')),
    }, opt);
    const servicePaths = opt.directory;
    this.loadToContext(servicePaths, 'service', opt);
    this.timing.end('Load Service');
  },

};
