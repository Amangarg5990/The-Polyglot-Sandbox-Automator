document.addEventListener('DOMContentLoaded', () => {
  const codeEditor = document.getElementById('codeEditor');
  const lineNumbers = document.getElementById('lineNumbers');
  const runBtn = document.getElementById('runBtn');
  const consoleOutput = document.getElementById('consoleOutput');
  const systemStatus = document.getElementById('systemStatus');
  const timeMetric = document.getElementById('timeMetric');
  const executionTime = document.getElementById('executionTime');
  const cacheBadge = document.getElementById('cacheBadge');
  const langBtns = document.querySelectorAll('.lang-btn');

  let activeLanguage = 'python';

  const templates = {
    python: `# Python 3.12 Sandboxed Sandbox Execution
import os
import sys

print("⚡ Running in isolated container...")
print(f"Running as user: runner")
print(f"Python Version: {sys.version.split()[0]}")
print(f"Process ID: {os.getpid()}")

# Test file system isolation (should fail to write to root)
try:
    with open("/etc/test.txt", "w") as f:
        f.write("test")
except Exception as e:
    print(f"FS Protection Check: PASS (Cannot write to root: {e})")
`,
    javascript: `// Node.js 20 Sandboxed Sandbox Execution
const os = require('os');
const fs = require('fs');

console.log("⚡ Running in isolated container...");
console.log(\`Running as user: runner\`);
console.log(\`Node.js Version: \${process.version}\`);
console.log(\`Process ID: \${process.pid}\`);

// Test file system isolation (should fail to write to root)
try {
    fs.writeFileSync("/etc/test.txt", "test");
} catch (e) {
    console.log(\`FS Protection Check: PASS (Cannot write to root: \${e.message})\`);
}
`
  };

  // Set initial template
  codeEditor.value = templates[activeLanguage];
  updateLineNumbers();

  // Handle language switching
  langBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      langBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const newLang = btn.getAttribute('data-lang');
      // Save current content if it was modified from template
      templates[activeLanguage] = codeEditor.value;
      
      activeLanguage = newLang;
      codeEditor.value = templates[newLang];
      updateLineNumbers();
      codeEditor.focus();
    });
  });

  // Track lines
  function updateLineNumbers() {
    const lines = codeEditor.value.split('\n');
    lineNumbers.innerHTML = Array(lines.length)
      .fill(0)
      .map((_, i) => `<span>${i + 1}</span>`)
      .join('');
  }

  codeEditor.addEventListener('input', updateLineNumbers);
  codeEditor.addEventListener('scroll', () => {
    lineNumbers.scrollTop = codeEditor.scrollTop;
  });

  // Check system health on startup
  async function checkHealth() {
    try {
      const res = await fetch('/health');
      if (res.ok) {
        const data = await res.json();
        systemStatus.classList.add('online');
        systemStatus.classList.remove('offline');
        systemStatus.querySelector('.status-label').textContent = `API: Active (tag: ${data.runnerTag})`;
      } else {
        throw new Error();
      }
    } catch (e) {
      systemStatus.classList.remove('online');
      systemStatus.classList.add('offline');
      systemStatus.querySelector('.status-label').textContent = 'API: Disconnected';
    }
  }

  checkHealth();
  setInterval(checkHealth, 10000); // Check health every 10s

  // Execute Code
  runBtn.addEventListener('click', async () => {
    const code = codeEditor.value;
    runBtn.disabled = true;
    runBtn.innerHTML = `
      <svg class="run-icon spinning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10" stroke-dasharray="32" />
      </svg>
      Executing...
    `;

    consoleOutput.innerHTML = `<div class="console-line system">Executing script in remote sandboxed container...</div>`;
    timeMetric.classList.add('hidden');
    cacheBadge.classList.add('hidden');

    try {
      const response = await fetch('/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          language: activeLanguage,
          code: code
        })
      });

      if (!response.ok) {
        const errJson = await response.json();
        throw new Error(errJson.error || 'Server error occurred during execution');
      }

      const data = await response.json();
      
      consoleOutput.innerHTML = ''; // clear initial executing text

      // Handle stdout
      if (data.stdout) {
        const stdoutDiv = document.createElement('div');
        stdoutDiv.className = 'console-line stdout';
        stdoutDiv.textContent = data.stdout;
        consoleOutput.appendChild(stdoutDiv);
      }

      // Handle stderr
      if (data.stderr) {
        const stderrDiv = document.createElement('div');
        stderrDiv.className = 'console-line stderr';
        stderrDiv.textContent = data.stderr;
        consoleOutput.appendChild(stderrDiv);
      }

      if (!data.stdout && !data.stderr) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'console-line system';
        emptyDiv.textContent = '[No output returned from program]';
        consoleOutput.appendChild(emptyDiv);
      }

      // Exit status line
      const statusDiv = document.createElement('div');
      if (data.exitCode === 0) {
        statusDiv.className = 'console-line exit-success';
        statusDiv.textContent = `\nProcess finished with exit code 0`;
      } else {
        statusDiv.className = 'console-line exit-error';
        statusDiv.textContent = `\nProcess exited with code ${data.exitCode}`;
      }
      consoleOutput.appendChild(statusDiv);

      // Duration & Cache Badge
      executionTime.textContent = `${data.durationMs}ms`;
      timeMetric.classList.remove('hidden');

      if (data.cached) {
        cacheBadge.classList.remove('hidden');
      }

    } catch (err) {
      consoleOutput.innerHTML = `<div class="console-line stderr">Error: ${err.message}</div>`;
    } finally {
      runBtn.disabled = false;
      runBtn.innerHTML = `
        <svg class="run-icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z"/>
        </svg>
        Run Code
      `;
    }
  });
});
