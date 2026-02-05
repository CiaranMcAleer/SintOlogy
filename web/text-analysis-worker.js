// Text Analysis Web Worker
// Runs NER and classification models in background thread to prevent UI freezing

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.1.2';

// Configure environment
env.allowRemoteModels = true;
env.allowLocalModels = false;

// Model state
let nerPipeline = null;
let classifierPipeline = null;

// Send status updates to main thread
function sendStatus(message) {
  self.postMessage({
    type: 'status',
    message
  });
}

// Handle messages from main thread
self.addEventListener('message', async (event) => {
  const { type, data } = event.data;
  
  try {
    if (type === 'init') {
      // Initialize models
      const { nerModel, classifierModel } = data;
      
      sendStatus('Loading Named Entity Recognition model...');
      nerPipeline = await pipeline('token-classification', nerModel);
      
      sendStatus('Loading Zero-Shot Classification model...');
      classifierPipeline = await pipeline('zero-shot-classification', classifierModel);
      
      // Signal ready
      self.postMessage({
        type: 'ready',
        message: 'Models loaded and ready'
      });
      
    } else if (type === 'ner') {
      // Perform Named Entity Recognition
      if (!nerPipeline) {
        throw new Error('NER model not initialized');
      }
      
      const { text } = data;
      const result = await nerPipeline(text);
      
      self.postMessage({
        type: 'ner-result',
        result
      });
      
    } else if (type === 'classify') {
      // Perform Zero-Shot Classification
      if (!classifierPipeline) {
        throw new Error('Classifier model not initialized');
      }
      
      const { text, labels, options } = data;
      const result = await classifierPipeline(text, labels, options);
      
      self.postMessage({
        type: 'classify-result',
        result
      });
      
    } else {
      throw new Error(`Unknown message type: ${type}`);
    }
    
  } catch (error) {
    console.error('Worker error:', error);
    self.postMessage({
      type: 'error',
      error: error.message
    });
  }
});
