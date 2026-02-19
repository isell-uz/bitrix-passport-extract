module.exports = { 
  apps : [{ 
      name: "scoring", 
      script: "app.js",          // or index.js / server.js 
      cwd: "/opt/bitrix-passport-extract", 
 
      exec_mode: "fork",         // IMPORTANT: node-like behavior 
      instances: 1, 
 
      watch: false, 
 
      env: { 
        NODE_ENV: "production" 
      } 
  }],
},
