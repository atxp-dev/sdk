#!/usr/bin/env node

import 'dotenv/config';
import { buildStreamableTransport, SolanaAccount } from '@atxp/client';
import { Message, generateText, experimental_createMCPClient as createMCPClient } from "ai";
import { openai } from "@ai-sdk/openai";

interface ServiceConfig {
  mcpServer: string;
  toolName: string;
  description: string;
  getArguments: (prompt: string) => Record<string, any>;
  getResult: (result: any) => any;
}

const SERVICES: Record<string, ServiceConfig> = {
  image: {
    mcpServer: 'https://image.corp.novellum.ai',
    toolName: 'image_create_image',
    description: 'image generation',
    getArguments: (prompt: string) => ({ prompt }),
    getResult: (result: any) => {
            // Handle different result formats based on service
      if (result.content && Array.isArray(result.content) && result.content[0]?.text) {
        try {
          const parsedResult = JSON.parse(result.content[0].text);
          return parsedResult.url
        } catch (e) {
          return result.content[0].text
        }
      }
    }
  },
  search: {
    mcpServer: 'https://search.corp.novellum.ai',
    toolName: 'search_search',
    description: 'search',
    getArguments: (prompt: string) => ({ query: prompt }),
    getResult: (result: any) => result.content[0].text
  }
};

const validateArgs = (args: string[]) => {
  if (args.length < 1) {
    console.error('Usage: node index.js "your prompt/query here"');
    console.error('Services available:');
    console.error('  image - Generate images');
    console.error('  search - Search for information');
    console.error('');
    console.error('Examples:');
    console.error('  node index.js "create an image of a beautiful sunset over mountains"');
    console.error('  node index.js "provide me with the latest news about AI"');
    process.exit(1);
  }
}

const validateEnvironment = (solanaEndpoint: string, solanaPrivateKey: string) => {
  if (!solanaEndpoint) {
    console.error('Error: SOLANA_ENDPOINT environment variable is required');
    console.error('Example: SOLANA_ENDPOINT=https://api.mainnet-beta.solana.com');
    process.exit(1);
  }

  if (!solanaPrivateKey) {
    console.error('Error: SOLANA_PRIVATE_KEY environment variable is required');
    console.error('Example: SOLANA_PRIVATE_KEY=your_base58_encoded_private_key');
    process.exit(1);
  }
}

const getToolsForService = async (account: SolanaAccount, service: string) => {
  const serviceConfig = SERVICES[service];

  // Create MCP client using atxpClient function
  const clientArgs = {
    mcpServer: serviceConfig.mcpServer,
    account,
  }

  const transport = buildStreamableTransport(clientArgs);

  const mcpClient = await createMCPClient({transport})
  return await mcpClient.tools()
}

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(1);
  validateArgs(args);

  const prompt = args[1];

  // Validate environment variables
  const solanaEndpoint = process.env.SOLANA_ENDPOINT || '';
  const solanaPrivateKey = process.env.SOLANA_PRIVATE_KEY ||''


  validateEnvironment(solanaEndpoint, solanaPrivateKey);

  try {
    const account = new SolanaAccount(solanaEndpoint, solanaPrivateKey)

    // For each service in SERVICES, get the tools. We need to reduce this
    // to a single array of all tools.
    const services = ['image', 'search'] as const;

    let tools = {}
    for (const service of services) {
      const mcpTools = await getToolsForService(account, service)
      tools = { ...tools, ...mcpTools }
    }

    const systemPrompt: Message[] = [
      {
        id: "1",
        role: "system",
        content: `AI assistant is a brand new, powerful, human-like artificial intelligence.
      The traits of AI include expert knowledge, helpfulness, cleverness, and articulateness.
      AI is a well-behaved and well-mannered individual.
      AI is always friendly, kind, and inspiring, and he is eager to provide vivid and thoughtful responses to the user.
      AI has the sum of all knowledge in their brain, and is able to accurately answer nearly any question about any topic in conversation.
      AI assistant prefers using the tools provided to it to answer questions.
      `,
      },
    ];
  
    const response = await generateText({
      model: openai("gpt-4o-mini"),
      tools,
      messages: [
        ...systemPrompt,
        {
          id: "2",
          role: "user",
          content: prompt,
        },
      ],
    });
    console.log(JSON.stringify(response, null, 2));
  } catch (error) {
    console.error(`Error:`, error);
    process.exit(1);
  }
}

// Run the application
main().catch(console.error); 