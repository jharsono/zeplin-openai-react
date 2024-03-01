import { React, useState } from 'react';
import OpenAI from 'openai';
import { ZeplinApi, Configuration } from '@zeplin/sdk';
import './App.css';

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const ZEPLIN_API_KEY = import.meta.env.VITE_ZEPLIN_API_KEY;

const openaiclient = new OpenAI({ apiKey: OPENAI_API_KEY, dangerouslyAllowBrowser: true });
const zeplin = new ZeplinApi(new Configuration({ accessToken: ZEPLIN_API_KEY }));

function App() {
  const [prompt, setPrompt] = useState('');
  const [chatbotResponse, setChatbotResponse] = useState('');

  async function getProject({ projectId }) {
    const { data } = await zeplin.projects.getProject(projectId);
    return data;
  }

  const internalFunctions = {
    getProject,
  };

  const functions = [
    {
      type: 'function',
      function: {
        name: 'getProject',
        description: 'Gets the project in Zeplin',
        parameters: {
          type: 'object',
          properties: {
            projectId: {
              type: 'string',
              description: 'The id of the project in mongodb object id format e.g. 65ddec7fe6d474b19d2bc5f1',
            },
          },
          required: ['projectId'],
        },
      },
    },
  ];

  async function callOpenAIAPI() {
    console.log('Calling the OpenAI API');
    const messages = [];
    messages.push({ role: 'system', content: "Don't make assumptions about what values to plug into functions. Ask for clarification if a user request is ambiguous." });
    messages.push({ role: 'user', content: prompt });

    const response = await openaiclient.chat.completions.create({
      messages,
      tools: functions,
      tool_choice: 'auto',
      model: 'gpt-4',
      temperature: 0.1,
      max_tokens: 50,
    });
    if (response.choices[0].finish_reason === 'tool_calls') {
      const functionName = response.choices[0].message.tool_calls[0].function.name;
      const args = JSON.parse(response.choices[0].message.tool_calls[0].function.arguments);
      // Call the function
      const result = await internalFunctions[functionName](args);
      messages.push({ role: 'system', content: `The result of the API call is ${JSON.stringify(result)}` });
      const response2 = await openaiclient.chat.completions.create({
        messages,
        tools: functions,
        tool_choice: 'auto',
        model: 'gpt-4',
        temperature: 0.1,
        max_tokens: 50,
      });
      setChatbotResponse(response2.choices[0].message.content);
      console.log('response2: ', response2.choices[0].message.content);
    } else {
      // If the response is a message, return the message
      console.log('response1: ', response.choices[0].message);
      setChatbotResponse(response.choices[0].message.content);
    }
  }

  return (
    <div className="App">
      <div>
        <textarea
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask me about your Zeplin project!"
          cols={50}
          rows={10}
        />
      </div>
      <div>
        <button
          type="button"
          onClick={callOpenAIAPI}
        >
          Ask
        </button>
        {
          chatbotResponse !== ''
            ? <h3>{chatbotResponse}</h3>
            : null
          }
      </div>
    </div>
  );
}

export default App;
