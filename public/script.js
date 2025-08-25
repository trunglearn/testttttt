document.addEventListener('DOMContentLoaded', () => {
  const tabs = document.querySelectorAll('.tab');
  const form = document.getElementById('setup-form');
  const baseToken = document.getElementById('base-token');
  const modeOptions = document.getElementById('mode-options');
  const additionalFields = document.getElementById('additional-fields');
  const pauseBtn = document.getElementById('pause-btn');
  let currentChain = 'solana';

  // Tab switching
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.disabled) return;
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentChain = tab.dataset.chain;
      updateForm();
    });
  });

  function updateForm() {
    baseToken.textContent = currentChain === 'solana' ? 'SOL' : 'BNB';
    modeOptions.innerHTML = '';
    additionalFields.innerHTML = '';

    if (currentChain === 'solana') {
      modeOptions.innerHTML = `
        <label>Mode</label>
        <select name="mode">
          <option>Buy (Heaven)</option>
          <option>MM (Raydium)</option>
        </select>
      `;
    } else if (currentChain === 'bnb') {
      modeOptions.innerHTML = `
        <label>Mode</label>
        <select name="mode">
          <option>Presale (BNBDAOS)</option>
          <option>DEX (PancakeSwap)</option>
          <option>MM (PancakeSwap)</option>
          <option>MMV2 (PancakeSwap)</option>
        </select>
      `;
      // Add DAO/Raise fields if presale
      form.querySelector('select[name="mode"]').addEventListener('change', (e) => {
        if (e.target.value.includes('Presale')) {
          additionalFields.innerHTML = `
            <label>Raise Token</label>
            <input type="text" name="raiseToken" placeholder="Enter Raise Token Address">
            <label>DAO Address</label>
            <input type="text" name="daoAddress" placeholder="Enter DAO Address">
          `;
        } else {
          additionalFields.innerHTML = '';
        }
      });
    }
  }

  // Submit form
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('chain', currentChain);
    formData.append('action', form.querySelector('input[name="action"]:checked').value);
    formData.append('tokenAddress', form.querySelector('input[name="tokenAddress"]').value);
    formData.append('maxBaseAmount', form.querySelector('input[name="maxBaseAmount"]').value);
    formData.append('schedule', form.querySelector('select[name="schedule"]').value);
    formData.append('mode', form.querySelector('select[name="mode"]')?.value || '');
    formData.append('wallets', document.getElementById('wallets-file').files[0]);

    const response = await fetch('/setup', {
      method: 'POST',
      body: formData,
    });
    const result = await response.json();
    alert(result.message);
  });

  // Pause button
  pauseBtn.addEventListener('click', async () => {
    const response = await fetch('/pause', { method: 'POST' });
    const result = await response.json();
    alert(result.message);
  });

  updateForm(); // Initial load
});