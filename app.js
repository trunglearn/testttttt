const express = require('express');
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
const cron = require('node-cron');
const path = require('path');
const app = express();
const upload = multer({ dest: 'uploads/' });

const SolanaProvider = require('./providers/solana');
const BnbProvider = require('./providers/bnb');

let botState = {
  running: false,
  task: null,
  providers: {},
};

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Root route for frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Download wallet template
app.get('/template', (req, res) => {
  const template = 'privateKey\nyour_private_key_here\n';
  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', 'attachment; filename=wallets_template.csv');
  res.send(template);
});

// Setup endpoint
app.post('/setup', upload.single('wallets'), async (req, res) => {
  const { chain, action, tokenAddress, maxBaseAmount, schedule, mode } = req.body; // Added mode for variations like presale, tx spam
  const file = req.file;

  if (!['solana', 'bnb'].includes(chain)) {
    return res.status(400).json({ error: 'Unsupported chain' });
  }
  if (!action) {
    return res.status(400).json({ error: 'Action required' });
  }
  if (!file) {
    return res.status(400).json({ error: 'Wallets file required' });
  }

  // Parse CSV for wallets
  const wallets = [];
  fs.createReadStream(file.path)
    .pipe(csv())
    .on('data', (row) => {
      if (row.privateKey) wallets.push(row.privateKey);
    })
    .on('end', async () => {
      fs.unlinkSync(file.path); // Cleanup

      let provider;
      if (chain === 'solana') {
        provider = new SolanaProvider();
      } else if (chain === 'bnb') {
        provider = new BnbProvider();
      }

      await provider.loadWallets(wallets);
      botState.providers[chain] = provider;

      // Stop existing task
      if (botState.task) botState.task.stop();
      botState.running = true;

      // Schedule based on input (e.g., 'every minute' -> '* * * * *')
      let cronSchedule = '* * * * *'; // Default every minute
      if (schedule === 'every hour') cronSchedule = '0 * * * *';
      // Add more schedule options as needed

      botState.task = cron.schedule(cronSchedule, async () => {
        if (!botState.running) return;
        try {
          await provider.performAction(action, tokenAddress, parseFloat(maxBaseAmount), mode);
          console.log(`Action ${action} performed on ${chain}`);
        } catch (err) {
          console.error('Error in scheduled task:', err);
        }
      });

      res.json({ message: 'Bot setup complete and started' });
    });
});

// Pause endpoint
app.post('/pause', (req, res) => {
  botState.running = false;
  if (botState.task) botState.task.stop();
  res.json({ message: 'Bot paused' });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});