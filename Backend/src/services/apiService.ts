import type { ModelType, OpenAIMessage, OpenAIRequest, OpenAIResponse, APIResponse } from '../types/common';
import { BaseApiService } from './baseApi';

export class ApiService extends BaseApiService {
  async callVisionAPI(base64Image: string, prompt: string): Promise<APIResponse> {
    // Ensure proper base64 format for OpenAI
    const formattedImage = base64Image.startsWith('data:') 
      ? base64Image 
      : `data:image/jpeg;base64,${base64Image}`;

    console.log('🔍 Sending image to OpenAI Vision API...');
    console.log('📝 Prompt length:', prompt.length);
    console.log('🖼️ Image format:', formattedImage.substring(0, 50) + '...');

    const requestPayload: OpenAIRequest = {
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt
            },
            {
              type: 'image_url',
              image_url: {
                url: formattedImage,
                detail: 'high'
              }
            }
          ]
        }
      ],
      max_tokens: 3000,
      temperature: 0.1
    };

    const response = await this.retryRequest(async () => {
      return await this.makeRequest<OpenAIResponse>('/chat/completions', {
        method: 'POST',
        body: JSON.stringify(requestPayload)
      });
    }, 3, 2000);

    if (!response.success) {
      throw new Error(`Vision API call failed: ${response.error}`);
    }

    const apiData = response.data!;
    const choice = apiData.choices[0];

    if (!choice?.message?.content) {
      throw new Error('Invalid response from Vision API');
    }

    return {
      content: choice.message.content,
      tokensUsed: apiData.usage.total_tokens,
      modelUsed: (process.env.GEMINI_MODEL || 'gemini-2.5-flash') as ModelType,
      inputTokens: apiData.usage.prompt_tokens,
      outputTokens: apiData.usage.completion_tokens
    };
  }

  async callTextAPI(prompt: string): Promise<APIResponse> {
    const requestPayload: OpenAIRequest = {
      model: 'gpt-4-turbo',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000,
      temperature: 0.1
    };

    const response = await this.retryRequest(async () => {
      return await this.makeRequest<OpenAIResponse>('/chat/completions', {
        method: 'POST',
        body: JSON.stringify(requestPayload)
      });
    }, 3, 1000);

    if (!response.success) {
      throw new Error(`Text API call failed: ${response.error}`);
    }

    const apiData = response.data!;
    const choice = apiData.choices[0];

    if (!choice?.message?.content) {
      throw new Error('Invalid response from Text API');
    }

    return {
      content: choice.message.content,
      tokensUsed: apiData.usage.total_tokens,
      modelUsed: 'gpt-4-turbo',
      inputTokens: apiData.usage.prompt_tokens,
      outputTokens: apiData.usage.completion_tokens
    };
  }
}