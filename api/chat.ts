
import type { VercelRequest, VercelResponse } from '@vercel/node';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<Record<string, unknown>>;
  images?: string[];
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: 'OpenAI API key is not configured on the server.',
    });
  }

  try {
    const { messages } = req.body ?? {};

    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 40) {
      return res.status(400).json({ error: 'Invalid messages.' });
    }

    const formattedMessages = messages.map((message: ChatMessage) => {
      if (
        !message ||
        !['system', 'user', 'assistant'].includes(message.role)
      ) {
        throw new Error('Invalid message role.');
      }

      const content = typeof message.content === 'string'
        ? message.content.slice(0, 20000)
        : message.content;

      if (message.images?.length && message.role === 'user') {
        return {
          role: message.role,
          content: [
            {
              type: 'text',
              text: typeof content === 'string' ? content : '',
            },
            ...message.images.slice(0, 3).map((image) => ({
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${image}`,
              },
            })),
          ],
        };
      }

      return { role: message.role, content };
    });

    const response = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: formattedMessages,
        max_tokens: 1200,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('OpenAI request failed:', response.status);
      return res.status(502).json({
        error: 'Cloud AI request failed. Check API billing and configuration.',
      });
    }

    return res.status(200).json({
      message: {
        role: 'assistant',
        content: data.choices?.[0]?.message?.content ?? '',
      },
    });
  } catch (error) {
    console.error('LocalMind API error:', error);
    return res.status(500).json({
      error: 'Unable to process the request.',
    });
  }
}
