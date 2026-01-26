document.getElementById('btn-try').onclick = () => switchTab('try');
document.getElementById('btn-history').onclick = () => switchTab('history');

function switchTab(mode) {
  document.getElementById('view-try').classList.toggle('hidden', mode !== 'try');
  document.getElementById('view-history').classList.toggle('hidden', mode !== 'history');
  document.getElementById('btn-try').classList.toggle('active', mode === 'try');
  document.getElementById('btn-history').classList.toggle('active', mode === 'history');
}

// Example: Triggering the AI fit
document.getElementById('generate-btn').addEventListener('click', async () => {
    const btn = document.getElementById('generate-btn');
    btn.innerText = "Fitting...";
    btn.disabled = true;
    
    // Call your Python Backend here
    // const result = await fetch('http://localhost:8000/tryon', { ... });
    
    btn.innerText = "Success!";
    setTimeout(() => { btn.innerText = "Generate Fit"; btn.disabled = false; }, 2000);
});