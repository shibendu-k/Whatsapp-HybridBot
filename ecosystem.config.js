module.exports = {
  apps: [{
    name: 'whatsapp-hybrid-bot',
    script: 'src/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '900M',
    env: {
      NODE_ENV: 'production'
    },
    error_file: 'logs/pm2-error.log',
    out_file: 'logs/pm2-out.log',
    log_file: 'logs/pm2-combined.log',
    time: true,
    merge_logs: true,
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000,
    // Improved stability settings
    exp_backoff_restart_delay: 100, // Exponential backoff between restarts (starts at 100ms)
    max_restarts: 10, // Maximum restarts within restart_delay window
    restart_delay: 4000, // Delay between restarts (4 seconds)
    min_uptime: '10s', // Minimum uptime to consider app started successfully
    // Crash handling
    cron_restart: '0 4 * * *' // Restart daily at 4 AM to clear memory and reset state
  }]
};
