# SintOlogy Web Interface - AI Features

## Overview

The SintOlogy web interface now includes AI-powered features using [Transformers.js](https://huggingface.co/docs/transformers.js) for client-side machine learning. All AI processing happens directly in the browser without requiring a backend server.

## Features

### 1. Question Answering (Main Page)

Located on the main explorer page (`index.html`), the Q&A feature allows you to ask natural language questions about the data currently displayed in the graph.

**How to use:**
1. Navigate to the main explorer page
2. Apply any filters or search to narrow down the data you want to query
3. Type your question in the "AI Q&A" input field
4. Click "Ask" or press Enter
5. The AI will analyze the current graph data and provide an answer with a confidence score

**Example questions:**
- "Who is Alex Parker?"
- "What campaigns are there?"
- "Which organization has a political wing?"
- "What actions were performed?"

**Model used:** `Xenova/distilbert-base-cased-distilled-squad` (DistilBERT fine-tuned on SQuAD)

### 2. Text Analysis Page

A dedicated page (`text-analysis.html`) for analyzing arbitrary text using AI. Access it via the "AI Text Analysis →" link in the header.

**Features:**

#### Named Entity Recognition (NER)
Extracts entities from your text:
- **PER/PERSON**: People mentioned in the text
- **ORG/ORGANISATION**: Organizations, companies, institutions
- **LOC/LOCATION**: Places, geographic locations
- **MISC**: Other named entities

#### Zero-Shot Classification
Classifies your text against the existing ontology classes:
- Shows which ontology classes (Person, Organisation, Campaign, etc.) are most relevant to your text
- Displays confidence scores for each classification
- Helps understand what type of data you're working with

#### Ontology Mapping
Maps extracted entities to existing ontology classes:
- Automatically maps PER → Person
- Automatically maps ORG → Organisation
- Suggests relevant ontology classes for your text
- Shows available properties for matched classes

**How to use:**
1. Navigate to the Text Analysis page
2. Paste or type your text in the input area
3. Click "Analyze Text"
4. Wait for the models to load (first time only, ~5-30 seconds depending on connection)
5. View the extracted entities, classifications, and ontology mappings

**Models used:**
- `Xenova/bert-base-NER` for entity extraction
- `Xenova/distilbert-base-uncased-mnli` for zero-shot classification

## Technical Details

### Architecture
- **Client-side only**: All AI processing happens in your browser using WebAssembly and WebGPU when available
- **No backend required**: Models are loaded from CDN and cached locally
- **Privacy-friendly**: Your data never leaves your browser

### Performance
- **First load**: Models download on first use (~10-50MB per model, one-time)
- **Subsequent uses**: Models are cached in browser, instant loading
- **Processing time**: 1-5 seconds depending on text length and device

### Requirements
- Modern web browser (Chrome 90+, Firefox 89+, Safari 15+, Edge 90+)
- JavaScript enabled
- Internet connection for initial model download
- Recommended: 4GB+ RAM for optimal performance

### Browser Compatibility
- ✅ Chrome/Edge (best performance with WebGPU)
- ✅ Firefox
- ✅ Safari
- ⚠️ May not work with strict content blockers or security policies that block CDN access

### Troubleshooting

**"Failed to load Transformers.js" error:**
- Check your internet connection
- Disable content blockers (uBlock Origin, etc.) for this site
- Try a different browser
- Check browser console for specific error messages

**Models taking too long to load:**
- First load requires downloading models (10-50MB), be patient
- Check your internet speed
- Models are cached after first load for instant future use

**Out of memory errors:**
- Close other browser tabs
- Try processing shorter text
- Restart your browser
- Use a device with more RAM

## Development

### Files
- `web/index.html` - Main explorer page with Q&A feature
- `web/app.js` - Main application logic including Q&A integration
- `web/text-analysis.html` - Text analysis page
- `web/text-analysis.js` - Text analysis logic with NER and classification
- `web/styles.css` - Styling for all features

### Customization

To use different models, edit the model IDs in the pipeline calls:

```javascript
// In app.js for Q&A
qaPipeline = await tf.pipeline('question-answering', 'YOUR-MODEL-ID');

// In text-analysis.js for NER
state.nerPipeline = await pipeline('token-classification', 'YOUR-MODEL-ID');

// In text-analysis.js for classification
state.classifierPipeline = await pipeline('zero-shot-classification', 'YOUR-MODEL-ID');
```

Available models: [Hugging Face Models](https://huggingface.co/models?library=transformers.js)

## Future Enhancements

Potential additions:
- Summarization of long text passages
- Sentiment analysis for posts
- Relationship extraction directly from text
- Automatic entity linking to existing graph nodes
- Export analysis results to graph format
- Batch processing of multiple texts

## Credits

Built with:
- [Transformers.js](https://github.com/xenova/transformers.js) by Xenova
- Models from [Hugging Face](https://huggingface.co/)
