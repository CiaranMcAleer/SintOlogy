// Web Worker for Q&A model inference
// Runs in a separate thread to prevent UI freezing

let pipeline = null;
let env = null;

// Listen for messages from main thread
self.addEventListener('message', async (event) => {
  const { type, data } = event.data;
  
  try {
    switch (type) {
      case 'init':
        await initModel(data.modelConfig);
        break;
      case 'inference':
        await runInference(data.messages, data.options);
        break;
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: error.message
    });
  }
});

async function initModel(modelConfig) {
  try {
    self.postMessage({ type: 'status', status: 'Loading Transformers.js library...' });
    
    // Import Transformers.js v3
    const module = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.1.2');
    const pipelineFn = module.pipeline;
    env = module.env;
    env.allowRemoteModels = true;
    env.allowLocalModels = false;
    
    self.postMessage({ type: 'status', status: 'Downloading model... This may take a moment.' });
    
    // Load the model
    pipeline = await pipelineFn(modelConfig.task, modelConfig.name);
    
    self.postMessage({ 
      type: 'ready',
      message: 'Model loaded and ready'
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: `Failed to initialize model: ${error.message}`
    });
  }
}

async function runInference(messages, options) {
  if (!pipeline) {
    throw new Error('Model not initialized');
  }
  
  try {
    self.postMessage({ type: 'status', status: 'Generating answer...' });
    
    // Run inference
    const result = await pipeline(messages, options);
    
    // Send result back to main thread
    self.postMessage({
      type: 'result',
      result: result
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: `Inference failed: ${error.message}`
    });
  }
}
