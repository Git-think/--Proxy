const os = require('os')

// 获取CPU核心数
const cpuCores = os.cpus().length

// 解析进程数配置
let instances = process.env.PM2_INSTANCES || 1
if (instances === 'max') {
  instances = cpuCores
} else if (!isNaN(instances)) {
  instances = parseInt(instances)
} else {
  instances = 1
}

// 限制进程数不能超过CPU核心数
if (instances > cpuCores) {
  console.log(`⚠️  警告: 配置的进程数(${instances})超过CPU核心数(${cpuCores})，自动调整为${cpuCores}`)
  instances = cpuCores
}

module.exports = {
  apps: [{
    name: 'qwen2api-proxy',
    script: './src/server.js',
    instances: instances,
    exec_mode: 'cluster',

    // 环境变量
    env: {
      PM2_USAGE: 'true'
    },

    // 日志配置
    log_file: './logs/pm2-combined.log',
    out_file: './logs/pm2-out.log',
    error_file: './logs/pm2-error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

    // 进程管理配置
    max_memory_restart: process.env.PM2_MAX_MEMORY || '1G',
    min_uptime: '10s',
    max_restarts: 10,

    // 监听文件变化
    watch: false,
    ignore_watch: ['node_modules', 'logs', 'caches', 'data'],

    // 其他配置
    merge_logs: true,
    time: true
  }]
}
