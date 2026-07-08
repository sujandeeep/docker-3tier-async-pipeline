const path = require('path');

async function download() {
  console.log('Downloading Xenova/toxic-bert model...');
  const { pipeline, env } = await import('@xenova/transformers');
  env.cacheDir = path.join(__dirname, '.cache');
  await pipeline('text-classification', 'Xenova/toxic-bert');
  console.log('Model downloaded and cached successfully.');
}

download().catch(err => {
  console.error('Failed to download model:', err);
  process.exit(1);
});
