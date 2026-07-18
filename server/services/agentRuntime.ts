export interface AgentFunctionCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AgentContent {
  role: 'user' | 'model';
  parts: Array<Record<string, unknown>>;
}

export interface AgentToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AgentModelRequest {
  systemInstruction: string;
  contents: AgentContent[];
  tools: AgentToolDeclaration[];
  forceToolNames?: string[];
}

export interface AgentModelResponse {
  content: AgentContent;
  functionCalls: AgentFunctionCall[];
}

export type AgentModel = (request: AgentModelRequest) => Promise<AgentModelResponse>;

export interface AgentToolResult<TTerminal = unknown> {
  response: Record<string, unknown>;
  terminalValue?: TTerminal;
}

export interface AgentTool<TContext, TTerminal = unknown> extends AgentToolDeclaration {
  execute: (
    args: Record<string, unknown>,
    context: TContext,
  ) => Promise<AgentToolResult<TTerminal>> | AgentToolResult<TTerminal>;
}

export interface AgentTurnUpdate {
  turn: number;
  maxTurns: number;
  turnsRemaining: number;
  phase: 'working' | 'tool' | 'completed';
  toolName?: string;
}

export interface RunAgentOptions<TContext, TTerminal> {
  name: string;
  systemInstruction: string;
  initialPrompt: string;
  maxTurns: number;
  model: AgentModel;
  tools: Array<AgentTool<TContext, TTerminal>>;
  context: TContext;
  terminalToolNames: string[];
  onTurn?: (update: AgentTurnUpdate) => void | Promise<void>;
}

function textContent(text: string): AgentContent {
  return { role: 'user', parts: [{ text }] };
}

function functionResponseContent(
  calls: AgentFunctionCall[],
  responses: Array<Record<string, unknown>>,
): AgentContent {
  return {
    role: 'user',
    parts: calls.map((call, index) => ({
      functionResponse: {
        ...(call.id ? { id: call.id } : {}),
        name: call.name,
        response: responses[index],
      },
    })),
  };
}

function budgetMessage(name: string, turn: number, maxTurns: number): string {
  const remaining = maxTurns - turn + 1;
  return `[${name} turn ${turn}/${maxTurns}; ${remaining} turn${remaining === 1 ? '' : 's'} remaining including this turn]`;
}

export async function runAgent<TContext, TTerminal>(
  options: RunAgentOptions<TContext, TTerminal>,
): Promise<TTerminal> {
  if (!Number.isInteger(options.maxTurns) || options.maxTurns < 1) {
    throw new Error('Agent maxTurns must be a positive integer');
  }
  if (options.terminalToolNames.length === 0) {
    throw new Error('Agent requires at least one terminal tool');
  }

  const toolsByName = new Map(options.tools.map(tool => [tool.name, tool]));
  const contents: AgentContent[] = [];

  for (let turn = 1; turn <= options.maxTurns; turn++) {
    const turnsRemaining = options.maxTurns - turn + 1;
    const turnPrefix = budgetMessage(options.name, turn, options.maxTurns);
    if (turn === 1) {
      contents.push(textContent(`${turnPrefix}\n\n${options.initialPrompt}`));
    } else if (contents.at(-1)?.role === 'model') {
      contents.push(textContent(
        `${turnPrefix}\nContinue the task by calling an available tool. You must finish with one of: ${options.terminalToolNames.join(', ')}.`,
      ));
    }

    await options.onTurn?.({
      turn,
      maxTurns: options.maxTurns,
      turnsRemaining,
      phase: 'working',
    });

    const response = await options.model({
      systemInstruction: options.systemInstruction,
      contents,
      tools: options.tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
      forceToolNames: turn === options.maxTurns ? options.terminalToolNames : undefined,
    });
    contents.push(response.content);

    if (response.functionCalls.length === 0) {
      continue;
    }

    const toolResponses: Array<Record<string, unknown>> = [];
    for (const call of response.functionCalls) {
      await options.onTurn?.({
        turn,
        maxTurns: options.maxTurns,
        turnsRemaining,
        phase: 'tool',
        toolName: call.name,
      });

      const tool = toolsByName.get(call.name);
      if (!tool) {
        toolResponses.push({
          ok: false,
          error: `Unknown tool: ${call.name}`,
          turnsRemaining: Math.max(0, options.maxTurns - turn),
        });
        continue;
      }

      try {
        const result = await tool.execute(call.args, options.context);
        const toolResponse = {
          ...result.response,
          turnsRemaining: Math.max(0, options.maxTurns - turn),
        };
        toolResponses.push(toolResponse);

        if (result.terminalValue !== undefined) {
          await options.onTurn?.({
            turn,
            maxTurns: options.maxTurns,
            turnsRemaining: Math.max(0, options.maxTurns - turn),
            phase: 'completed',
            toolName: call.name,
          });
          return result.terminalValue;
        }
      } catch (error) {
        toolResponses.push({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          turnsRemaining: Math.max(0, options.maxTurns - turn),
        });
      }
    }

    contents.push(functionResponseContent(response.functionCalls, toolResponses));
  }

  throw new Error(`${options.name} exhausted its ${options.maxTurns}-turn budget without completing`);
}
