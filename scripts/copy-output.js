const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'output');
const dest = path.join(__dirname, '..', 'dist', 'output');

fs.mkdirSync(dest, { recursive: true });
if (fs.existsSync(src)) {
  fs.cpSync(src, dest, { recursive: true });
}
