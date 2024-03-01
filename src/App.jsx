import { React, useState, useEffect } from 'react';
import OpenAI from 'openai';
import { ZeplinApi, Configuration } from '@zeplin/sdk';
import SwaggerParser from '@apidevtools/swagger-parser';
import { stringify } from 'flatted';
import './App.css';

function App() {
  const [prompt, setPrompt] = useState('');
  const [chatbotResponse, setChatbotResponse] = useState('');
  const [apiSpec, setApiSpec] = useState(null);
  const [apiFunctions, setApiFunctions] = useState({});

  const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
  const ZEPLIN_API_KEY = import.meta.env.VITE_ZEPLIN_API_KEY;
  const ZEPLIN_PROJECT_ID = import.meta.env.VITE_ZEPLIN_PROJECT_ID;
  const ZEPLIN_API_BASE_URL = import.meta.env.VITE_ZEPLIN_API_BASE_URL;

  const openaiclient = new OpenAI({ apiKey: OPENAI_API_KEY, dangerouslyAllowBrowser: true });
  const zeplin = new ZeplinApi(new Configuration({ accessToken: ZEPLIN_API_KEY }));

  useEffect(() => {
    const fetchApiSpec = async () => {
      try {
        const specFilePath = '/zeplin-oas.yaml';
        const api = await SwaggerParser.validate(specFilePath);

        // Extract only necessary information from apiSpec
        const relevantInfo = {
          info: api.info,
          paths: Object.keys(api.paths),
          components: api.components ? Object.keys(api.components) : [],
        };

        // Generate function mappings for API calls
        const functions = {};
        Object.entries(api.paths).forEach(([path, methods]) => {
          Object.entries(methods).forEach(([method, operation]) => {
            const functionName = `${method.toLowerCase()}${path.replace(/\//g, '_')}`;
            functions[functionName] = async (params) => {
              // Make HTTP request based on the operation details
              // Example using fetch API
              const response = await fetch(`${ZEPLIN_API_BASE_URL}${path}`, {
                method: method.toUpperCase(),
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(params),
              });
              return response.json();
            };
          });
        });

        // Set the apiSpec and apiFunctions states
        setApiSpec(relevantInfo);
        setApiFunctions(functions);
      } catch (error) {
        console.error('Error parsing/resolving OpenAPI spec:', error);
      }
    };

    fetchApiSpec();
  }, []);

  async function getProject({ projectId }) {
    const { data } = await zeplin.projects.getProject(projectId);
    return data;
  }
  async function getProjectScreenIds({ projectId }) {
    const { data } = await zeplin.screens.getProjectScreens(projectId);
    console.log('screens: ', data);
    return data.map((screen) => {
      const { id, name } = screen;
      return (
        {
          id,
          name,
        }
      );
    });
  }

  const extractLayerContents = (array) => {
    let contents = [];
    array.forEach((obj) => {
      if (obj.layers) {
        // Recursively traverse nested layers
        contents = contents.concat(extractLayerContents(obj.layers));
      }
      if (obj.content) {
        contents.push(obj.content);
      }
    });
    return contents;
  };

  async function getLatestScreenVersionContents({ projectId, screenId }) {
    const { data } = await zeplin.screens.getLatestScreenVersion(projectId, screenId);
    console.log('screen: ', data);
    const { layers } = data;

    return extractLayerContents(layers);
  }

  async function getProjectTextContents({ projectId }) {
    const screens = await getProjectScreenIds({ projectId });
    console.log('getProjectTextContents', screens);
    const textContents = screens.map((screen) => {
      const { id: screenId } = screen;
      return getLatestScreenVersionContents({ projectId, screenId });
    });
    const textResults = await Promise.all(textContents);
    const combinedTextContents = textResults.reduce((acc, textData) => {
      acc.push(textData);
      return acc;
    }, []);
    return combinedTextContents;
  }

  const internalFunctions = {
    getProject,
    getProjectScreenIds,
    getLatestScreenVersionContents,
    getProjectTextContents,
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
    {
      type: 'function',
      function: {
        name: 'getProjectScreenIds',
        description: 'Gets the project screen IDs in Zeplin',
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
    {
      type: 'function',
      function: {
        name: 'getLatestScreenVersionContents',
        description: 'Gets the text contents of the most recent screen version of a given screen in Zeplin',
        parameters: {
          type: 'object',
          properties: {
            projectId: {
              type: 'string',
              description: 'The id of the project in mongodb object id format e.g. 65ddec7fe6d474b19d2bc5f1',
            },
            screenId: {
              type: 'string',
              description: 'The id of the screen in mongodb object id format e.g. 65ddec7fe6d474b19d2bc5f1',
            },
          },
          required: ['projectId', 'screenId'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'getProjectTextContents',
        description: 'Iterates through function getLatestScreenVersionContents to combine all text contents in project',
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
    messages.push({ role: 'user', content: `${prompt} The project ID is ${ZEPLIN_PROJECT_ID}. Relevant information from the OpenAPI spec includes: ${stringify(apiSpec)}` });

    // Add function names to the user prompt
    Object.keys(apiFunctions).forEach((functionName) => {
      messages[1].content += `\n${functionName}`;
    });

    try {
      const response = await openaiclient.chat.completions.create({
        messages,
        model: 'gpt-4',
        temperature: 0.1,
        max_tokens: 500,
      });

      if (response.choices[0].finish_reason === 'stop') {
        setChatbotResponse(response.choices[0].message.content);
      } else {
        // Process tool calls
        const toolCalls = response.choices[0].message.tool_calls;
        for (const toolCall of toolCalls) {
          const functionName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);
          // Call the function
          const result = await apiFunctions[functionName](args);
          // Handle the result, you can setChatbotResponse here or do any other processing
          console.log('Result of function call:', result);
        }
      }
    } catch (error) {
      console.error('Error: ', error);
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
