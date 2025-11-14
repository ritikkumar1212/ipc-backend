const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const apiKey = process.env.OPENROUTER_API_KEY;
app.post('/analyze', async (req, res) => {
  const { scenario } = req.body;

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: "llama3-8b-8192",
        messages: [
          {
            role: 'system',
            content: 'You are a legal expert who responds with Indian IPC sections based on crime scenarios.'
          },
          {
            role: 'user',
            content: scenario
          }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'IPC Analyzer App'
        }
      }
    );

    // ✅ SAFETY CHECK
    if (
      !response.data ||
      !response.data.choices ||
      !response.data.choices[0] ||
      !response.data.choices[0].message ||
      !response.data.choices[0].message.content
    ) {
      console.error('⚠️ Unexpected API response:', JSON.stringify(response.data, null, 2));
      return res.status(500).json({ error: 'Invalid response from model.' });
    }

    const reply = response.data.choices[0].message.content;
    res.json({ result: reply });
  } catch (err) {
    console.error('❌ Error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to get response from OpenRouter.' });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
