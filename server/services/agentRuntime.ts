export const MAX_SUBAGENTS_PER_AGENT = 5;
export const SPAWN_SUBAGENT_TOOL_NAME = 'spawn_subagent';

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
  signal?: AbortSignal;
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

export interface SubagentSpawnRequest {
  sessionId: string;
  index: number;
  task: string;
  handoff: string;
}

export interface SubagentTurnUpdate extends AgentTurnUpdate, SubagentSpawnRequest {}

/** Configures optional delegation for any agent without coupling it to a domain workflow. */
export interface AgentSubagentOptions<TParentContext, TSubagentContext> {
  systemInstruction: string;
  maxTurns: number;
  maxSubagents?: number;
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

export interface RunAgentOptions<TContext, TTerminal, TSubagentContext = Record<string, never>> {
  name: string;
  systemInstruction: string;
  initialPrompt: string;
  maxTurns: number;
  model: AgentModel;
  tools: Array<AgentTool<TContext, TTerminal>>;
  context: TContext;
  terminalToolNames: string[];
  subagents?: AgentSubagentOptions<TContext, TSubagentContext>;
  onTurn?: (update: AgentTurnUpdate) => void | Promise<void>;
  signal?: AbortSignal;
}

interface SubagentBudget {
  spawnedCount: number;
  maxSubagents: number;
}

interface ToolBatchResult<TTerminal> {
  responses: Array<Record<string, unknown>>;
  terminal?: { value: TTerminal; toolName: string };
}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function textContent(text: string): AgentContent {
  return { role: 'user', parts: [{ text }] };
}

/** Converts tool results into the provider-neutral function-response turn. */
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

/** Explains the generic delegation contract only when the runtime enables it. */
function delegationMessage(maxSubagents: number): string {
  return [
    `You may delegate independent work with ${SPAWN_SUBAGENT_TOOL_NAME}.`,
    `You may start at most ${maxSubagents} sub-agent sessions in this run.`,
    'You may start several sub-agents in one turn; the runtime waits for all of them and returns every result before your next turn.',
    `A turn that calls ${SPAWN_SUBAGENT_TOOL_NAME} must contain only ${SPAWN_SUBAGENT_TOOL_NAME} calls.`,
    'Call at most one ordinary tool in any other turn so each dependent action can use the previous result.',
  ].join(' ');
}

function initialTurnPrompt<TContext, TTerminal, TSubagentContext>(
  options: RunAgentOptions<TContext, TTerminal, TSubagentContext>,
  budget: SubagentBudget,
): string {
  return [
    budgetMessage(options.name, 1, options.maxTurns),
    options.subagents ? delegationMessage(budget.maxSubagents) : undefined,
    options.initialPrompt,
  ].filter((part): part is string => Boolean(part)).join('\n\n');
}

function continuationPrompt(name: string, turn: number, maxTurns: number, terminalToolNames: string[]): string {
  return [
    budgetMessage(name, turn, maxTurns),
    `Continue by calling an available tool. Finish with one of: ${terminalToolNames.join(', ')}.`,
  ].join('\n');
}

/** Adds only the user content needed to begin or recover a tool-free turn. */
function prepareTurnContents<TContext, TTerminal, TSubagentContext>(
  options: RunAgentOptions<TContext, TTerminal, TSubagentContext>,
  contents: AgentContent[],
  budget: SubagentBudget,
  turn: number,
): void {
  if (turn === 1) {
    contents.push(textContent(initialTurnPrompt(options, budget)));
  } else if (contents.at(-1)?.role === 'model') {
    contents.push(textContent(
      continuationPrompt(options.name, turn, options.maxTurns, options.terminalToolNames),
    ));
  }
}

function spawnSubagentDeclaration(maxSubagents: number): AgentToolDeclaration {
  return {
    name: SPAWN_SUBAGENT_TOOL_NAME,
    description: `Start an isolated generic sub-agent for independent work. Up to ${maxSubagents} sessions may be started; batched sessions all finish before the next parent turn.`,
    parameters: {
      type: 'OBJECT',
      properties: {
        task: {
          type: 'STRING',
          description: 'A concrete, bounded task for the sub-agent to complete.',
        },
        handoff: {
          type: 'STRING',
          description: 'All request context, constraints, and current results needed to complete the task independently.',
        },
      },
      required: ['task', 'handoff'],
    },
  };
}

function availableToolDeclarations<TContext, TTerminal, TSubagentContext>(
  options: RunAgentOptions<TContext, TTerminal, TSubagentContext>,
  budget: SubagentBudget,
): AgentToolDeclaration[] {
  const declarations = options.tools.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));
  if (options.subagents && budget.spawnedCount < budget.maxSubagents) {
    declarations.push(spawnSubagentDeclaration(budget.maxSubagents));
  }
  return declarations;
}

function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
}

/** Validates limits once so turn execution can remain focused on orchestration. */
function validateRunOptions<TContext, TTerminal, TSubagentContext>(
  options: RunAgentOptions<TContext, TTerminal, TSubagentContext>,
): SubagentBudget {
  validatePositiveInteger(options.maxTurns, 'Agent maxTurns');
  if (options.terminalToolNames.length === 0) {
    throw new Error('Agent requires at least one terminal tool');
  }

  const maxSubagents = options.subagents?.maxSubagents ?? MAX_SUBAGENTS_PER_AGENT;
  if (options.subagents) {
    validatePositiveInteger(options.subagents.maxTurns, 'Sub-agent maxTurns');
    validatePositiveInteger(maxSubagents, 'Agent maxSubagents');
    if (maxSubagents > MAX_SUBAGENTS_PER_AGENT) {
      throw new Error(`Agent maxSubagents cannot exceed ${MAX_SUBAGENTS_PER_AGENT}`);
    }
  }

  return { spawnedCount: 0, maxSubagents };
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

function createSubagentExitTool<TContext>(): AgentTool<TContext, string> {
  return {
    name: 'subagent_exit',
    description: 'Close this sub-agent session and return its complete result to the parent agent.',
    parameters: {
      type: 'OBJECT',
      properties: {
        result: {
          type: 'STRING',
          description: 'The complete result, including findings, evidence, or recommended changes.',
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
}

function parseSubagentRequest(
  call: AgentFunctionCall,
  parentName: string,
  index: number,
): SubagentSpawnRequest {
  const task = typeof call.args.task === 'string' ? call.args.task.trim() : '';
  const handoff = typeof call.args.handoff === 'string' ? call.args.handoff.trim() : '';
  if (!task) throw new Error('Sub-agent task is required.');
  if (!handoff) throw new Error('Sub-agent handoff is required.');
  return {
    sessionId: `${parentName}-subagent-${index}`,
    index,
    task,
    handoff,
  };
}

/** Runs one isolated child session to completion before returning its result. */
async function runSubagent<TParentContext, TParentTerminal, TSubagentContext>(
  request: SubagentSpawnRequest,
  options: RunAgentOptions<TParentContext, TParentTerminal, TSubagentContext>,
): Promise<string> {
  const subagents = options.subagents!;
  const context = subagents.createContext(request);
  return runAgent({
    name: request.sessionId,
    systemInstruction: subagents.systemInstruction,
    initialPrompt: subagentInitialPrompt(request),
    maxTurns: subagents.maxTurns,
    model: subagents.modelFactory(request),
    tools: [...(subagents.tools?.(request) ?? []), createSubagentExitTool<TSubagentContext>()],
    context,
    terminalToolNames: ['subagent_exit'],
    onTurn: update => subagents.onTurn?.({ ...request, ...update }),
    signal: options.signal,
  });
}

function toolError(error: unknown, turnsRemaining: number): Record<string, unknown> {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    turnsRemaining,
  };
}

/** Starts a valid batch concurrently and waits for every session before returning. */
async function executeSubagentBatch<TContext, TTerminal, TSubagentContext>(
  calls: AgentFunctionCall[],
  options: RunAgentOptions<TContext, TTerminal, TSubagentContext>,
  budget: SubagentBudget,
  turnsRemaining: number,
): Promise<Array<Record<string, unknown>>> {
  const remainingCapacity = budget.maxSubagents - budget.spawnedCount;
  if (calls.length > remainingCapacity) {
    return calls.map(() => toolError(
      new Error(`This run can start only ${remainingCapacity} more sub-agent session${remainingCapacity === 1 ? '' : 's'}.`),
      turnsRemaining,
    ));
  }

  const requests: Array<SubagentSpawnRequest | Error> = [];
  let nextIndex = budget.spawnedCount + 1;
  for (const call of calls) {
    try {
      const request = parseSubagentRequest(call, options.name, nextIndex);
      await options.subagents!.beforeSpawn?.(request, options.context);
      requests.push(request);
      nextIndex += 1;
    } catch (error) {
      requests.push(error instanceof Error ? error : new Error(String(error)));
    }
  }

  const validRequests = requests.filter((request): request is SubagentSpawnRequest => !(request instanceof Error));
  budget.spawnedCount += validRequests.length;
  const results = await Promise.all(validRequests.map(async request => {
    try {
      throwIfAborted(options.signal);
      const result = await runSubagent(request, options);
      throwIfAborted(options.signal);
      await options.subagents!.afterSpawn?.(request, result, options.context);
      return { request, result };
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      return { request, error };
    }
  }));
  const resultsByIndex = new Map(results.map(result => [result.request.index, result]));

  return requests.map(request => {
    if (request instanceof Error) return toolError(request, turnsRemaining);
    const execution = resultsByIndex.get(request.index);
    if (execution && 'error' in execution) return toolError(execution.error, turnsRemaining);
    return {
      ok: true,
      sessionId: request.sessionId,
      result: execution?.result,
      subagentsRemaining: budget.maxSubagents - budget.spawnedCount,
      turnsRemaining,
    };
  });
}

function invalidBatchResponses(calls: AgentFunctionCall[], message: string, turnsRemaining: number) {
  return calls.map(() => toolError(new Error(message), turnsRemaining));
}

/** Executes one ordinary tool, preventing precomputed dependent calls in the same model turn. */
async function executeOrdinaryTool<TContext, TTerminal, TSubagentContext>(
  call: AgentFunctionCall,
  options: RunAgentOptions<TContext, TTerminal, TSubagentContext>,
  toolsByName: Map<string, AgentTool<TContext, TTerminal>>,
  turn: number,
  turnsRemaining: number,
): Promise<ToolBatchResult<TTerminal>> {
  await options.onTurn?.({
    turn,
    maxTurns: options.maxTurns,
    turnsRemaining: turnsRemaining + 1,
    phase: 'tool',
    toolName: call.name,
  });
  throwIfAborted(options.signal);

  const tool = toolsByName.get(call.name);
  if (!tool) {
    return { responses: [toolError(new Error(`Unknown tool: ${call.name}`), turnsRemaining)] };
  }

  try {
    const result = await tool.execute(call.args, options.context);
    throwIfAborted(options.signal);
    const response = { ...result.response, turnsRemaining };
    if (result.terminalValue === undefined) return { responses: [response] };
    if (!options.terminalToolNames.includes(call.name)) {
      return { responses: [toolError(new Error(`Tool ${call.name} is not a terminal tool.`), turnsRemaining)] };
    }
    return {
      responses: [response],
      terminal: { value: result.terminalValue, toolName: call.name },
    };
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    return { responses: [toolError(error, turnsRemaining)] };
  }
}

/** Applies the per-turn tool contract and returns results in model call order. */
async function executeToolCalls<TContext, TTerminal, TSubagentContext>(
  calls: AgentFunctionCall[],
  options: RunAgentOptions<TContext, TTerminal, TSubagentContext>,
  toolsByName: Map<string, AgentTool<TContext, TTerminal>>,
  budget: SubagentBudget,
  turn: number,
): Promise<ToolBatchResult<TTerminal>> {
  const turnsRemaining = Math.max(0, options.maxTurns - turn);
  const spawnCalls = calls.filter(call => call.name === SPAWN_SUBAGENT_TOOL_NAME);

  if (spawnCalls.length > 0) {
    if (!options.subagents) {
      return { responses: invalidBatchResponses(calls, 'Sub-agent capability is not enabled.', turnsRemaining) };
    }
    if (spawnCalls.length !== calls.length) {
      return {
        responses: invalidBatchResponses(
          calls,
          `A turn that spawns sub-agents cannot call other tools. Wait for the sub-agent results, then continue on the next turn.`,
          turnsRemaining,
        ),
      };
    }
    await options.onTurn?.({
      turn,
      maxTurns: options.maxTurns,
      turnsRemaining: turnsRemaining + 1,
      phase: 'tool',
      toolName: SPAWN_SUBAGENT_TOOL_NAME,
    });
    throwIfAborted(options.signal);
    return {
      responses: await executeSubagentBatch(spawnCalls, options, budget, turnsRemaining),
    };
  }

  if (calls.length > 1) {
    return {
      responses: invalidBatchResponses(
        calls,
        'Call only one ordinary tool per turn so dependent actions can use the previous tool result.',
        turnsRemaining,
      ),
    };
  }

  return executeOrdinaryTool(calls[0], options, toolsByName, turn, turnsRemaining);
}

/** Runs a bounded tool-using agent, optionally with generic sub-agent delegation. */
export async function runAgent<TContext, TTerminal, TSubagentContext = Record<string, never>>(
  options: RunAgentOptions<TContext, TTerminal, TSubagentContext>,
): Promise<TTerminal> {
  const budget = validateRunOptions(options);
  const toolsByName = new Map(options.tools.map(tool => [tool.name, tool]));
  const contents: AgentContent[] = [];

  for (let turn = 1; turn <= options.maxTurns; turn++) {
    throwIfAborted(options.signal);
    prepareTurnContents(options, contents, budget, turn);
    const turnsRemaining = options.maxTurns - turn + 1;
    await options.onTurn?.({ turn, maxTurns: options.maxTurns, turnsRemaining, phase: 'working' });
    throwIfAborted(options.signal);

    const response = await options.model({
      systemInstruction: options.systemInstruction,
      contents,
      tools: availableToolDeclarations(options, budget),
      forceToolNames: turn === options.maxTurns ? options.terminalToolNames : undefined,
      signal: options.signal,
    });
    throwIfAborted(options.signal);
    contents.push(response.content);
    if (response.functionCalls.length === 0) continue;

    const result = await executeToolCalls(
      response.functionCalls,
      options,
      toolsByName,
      budget,
      turn,
    );
    if (result.terminal) {
      await options.onTurn?.({
        turn,
        maxTurns: options.maxTurns,
        turnsRemaining: Math.max(0, options.maxTurns - turn),
        phase: 'completed',
        toolName: result.terminal.toolName,
      });
      return result.terminal.value;
    }
    contents.push(functionResponseContent(response.functionCalls, result.responses));
  }

  throw new Error(`${options.name} exhausted its ${options.maxTurns}-turn budget without completing`);
}
