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

export interface SubagentSpawnRequest {
  sessionId: string;
  index: number;
  task: string;
  handoff: string;
}

export interface SubagentTurnUpdate extends AgentTurnUpdate, SubagentSpawnRequest {}

export interface SpawnSubagentToolOptions<
  TParentContext,
  TParentTerminal,
  TSubagentContext,
> {
  parentName: string;
  systemInstruction: string;
  maxTurns: number;
  modelFactory: (request: SubagentSpawnRequest) => AgentModel;
  createContext: (request: SubagentSpawnRequest) => TSubagentContext;
  tools?: (request: SubagentSpawnRequest) => Array<AgentTool<TSubagentContext, string>>;
  beforeSpawn?: (
    request: SubagentSpawnRequest,
    parentContext: TParentContext,
  ) => void | Promise<void>;
  afterSpawn?: (
    request: SubagentSpawnRequest,
    result: string,
    parentContext: TParentContext,
  ) => void | Promise<void>;
  onTurn?: (update: SubagentTurnUpdate) => void | Promise<void>;
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

function subagentInitialPrompt(request: SubagentSpawnRequest): string {
  return [
    'Assigned task:',
    request.task,
    '',
    'Handoff from the parent agent:',
    request.handoff,
  ].join('\n');
}

export function createSpawnSubagentTool<
  TParentContext,
  TParentTerminal,
  TSubagentContext,
>(
  options: SpawnSubagentToolOptions<TParentContext, TParentTerminal, TSubagentContext>,
): AgentTool<TParentContext, TParentTerminal> {
  let spawnedCount = 0;

  return {
    name: 'spawn_subagent',
    description: 'Start an isolated generic sub-agent session. Provide a self-contained task and complete handoff containing all context and results the sub-agent needs.',
    parameters: {
      type: 'OBJECT',
      properties: {
        task: {
          type: 'STRING',
          description: 'The bounded task for the sub-agent to complete.',
        },
        handoff: {
          type: 'STRING',
          description: 'A self-contained handoff with the original request, relevant constraints, and results produced so far.',
        },
      },
      required: ['task', 'handoff'],
    },
    execute: async (args, parentContext) => {
      const task = typeof args.task === 'string' ? args.task.trim() : '';
      const handoff = typeof args.handoff === 'string' ? args.handoff.trim() : '';
      if (!task) throw new Error('Sub-agent task is required.');
      if (!handoff) throw new Error('Sub-agent handoff is required.');

      const index = spawnedCount + 1;
      const request: SubagentSpawnRequest = {
        sessionId: `${options.parentName}-subagent-${index}`,
        index,
        task,
        handoff,
      };
      await options.beforeSpawn?.(request, parentContext);
      spawnedCount = index;

      const exitTool: AgentTool<TSubagentContext, string> = {
        name: 'subagent_exit',
        description: 'Close this sub-agent session and return its completed result to the parent agent.',
        parameters: {
          type: 'OBJECT',
          properties: {
            result: {
              type: 'STRING',
              description: 'The complete result for the parent agent, including findings, evidence, or recommended changes.',
            },
          },
          required: ['result'],
        },
        execute: args => {
          const result = typeof args.result === 'string' ? args.result.trim() : '';
          if (!result) throw new Error('Sub-agent result is required.');
          return { response: { ok: true }, terminalValue: result };
        },
      };
      const result = await runAgent({
        name: request.sessionId,
        systemInstruction: options.systemInstruction,
        initialPrompt: subagentInitialPrompt(request),
        maxTurns: options.maxTurns,
        model: options.modelFactory(request),
        tools: [...(options.tools?.(request) ?? []), exitTool],
        context: options.createContext(request),
        terminalToolNames: ['subagent_exit'],
        onTurn: update => options.onTurn?.({ ...request, ...update }),
      });

      await options.afterSpawn?.(request, result, parentContext);
      return {
        response: {
          ok: true,
          sessionId: request.sessionId,
          result,
        },
      };
    },
  };
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
