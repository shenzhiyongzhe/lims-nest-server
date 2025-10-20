module.exports = {
  apps: [{
    name: 'nestjs-backend',
    script: 'dist/src/main.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: '/var/log/backend/err.log',
    out_file: '/var/log/backend/out.log',
    log_file: '/var/log/backend/combined.log',
    time: true
  }]
}