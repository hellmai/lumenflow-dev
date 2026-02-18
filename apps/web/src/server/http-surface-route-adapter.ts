import { EventEmitter } from 'node:events';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';
import type { HttpSurface } from '@lumenflow/surfaces/http/server';

const HTTP_STATUS = {
  OK: 200,
} as const;

const URL_PART = {
  ROOT_PATH: '/',
} as const;

const EVENT_NAME = {
  CLOSE: 'close',
  FINISH: 'finish',
} as const;

const PATH_PREFIX = '/';

interface ForwardToHttpSurfaceInput {
  readonly request: Request;
  readonly surface: HttpSurface;
  readonly pathName?: string;
}

type NodeRequest = IncomingMessage & {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
};

type HeaderValue = string | number | readonly string[];

function normalizePathName(pathName: string | undefined): string {
  if (!pathName || pathName.length === 0) {
    return URL_PART.ROOT_PATH;
  }

  if (pathName.startsWith(PATH_PREFIX)) {
    return pathName;
  }

  return `${PATH_PREFIX}${pathName}`;
}

function toIncomingHeaders(headers: Headers): IncomingHttpHeaders {
  return Object.fromEntries(headers.entries()) as IncomingHttpHeaders;
}

function formatNodeRequestUrl(request: Request, pathName?: string): string {
  const parsedUrl = new URL(request.url);
  const normalizedPathName = normalizePathName(pathName ?? parsedUrl.pathname);
  return `${normalizedPathName}${parsedUrl.search}`;
}

async function createNodeRequest(input: ForwardToHttpSurfaceInput): Promise<NodeRequest> {
  const nodeRequest = new PassThrough() as unknown as PassThrough & NodeRequest;
  nodeRequest.method = input.request.method;
  nodeRequest.url = formatNodeRequestUrl(input.request, input.pathName);
  nodeRequest.headers = toIncomingHeaders(input.request.headers);

  const bodyBuffer = Buffer.from(await input.request.arrayBuffer());
  if (bodyBuffer.byteLength > 0) {
    nodeRequest.end(bodyBuffer);
  } else {
    nodeRequest.end();
  }

  return nodeRequest;
}

function normalizeHeaderValue(value: HeaderValue): string {
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  return String(value);
}

function toUint8Array(chunk: string | Buffer): Uint8Array {
  if (Buffer.isBuffer(chunk)) {
    return new Uint8Array(chunk);
  }
  return new TextEncoder().encode(chunk);
}

class NodeResponseBridge extends EventEmitter {
  statusCode: number = HTTP_STATUS.OK;
  private readonly responseHeaders = new Map<string, string>();
  private readonly bufferedChunks: Uint8Array[] = [];
  private streamClosed = false;
  private closeNotified = false;
  private streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  readonly bodyStream: ReadableStream<Uint8Array>;

  constructor(private readonly notifyRequestClosed: () => void) {
    super();

    this.bodyStream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.streamController = controller;
        this.flushBufferedChunks();
      },
      cancel: () => {
        this.notifyClosed();
      },
    });
  }

  setHeader(name: string, value: HeaderValue): this {
    this.responseHeaders.set(name.toLowerCase(), normalizeHeaderValue(value));
    return this;
  }

  writeHead(statusCode: number, headers?: Record<string, string>): this {
    this.statusCode = statusCode;

    if (headers) {
      for (const [name, value] of Object.entries(headers)) {
        this.setHeader(name, value);
      }
    }

    return this;
  }

  write(chunk: string | Buffer): boolean {
    const bytes = toUint8Array(chunk);
    if (this.streamController) {
      this.streamController.enqueue(bytes);
    } else {
      this.bufferedChunks.push(bytes);
    }
    return true;
  }

  end(chunk?: string | Buffer): this {
    if (chunk !== undefined) {
      this.write(chunk);
    }

    if (!this.streamClosed) {
      if (this.streamController) {
        this.streamController.close();
      }
      this.streamClosed = true;
    }

    this.emit(EVENT_NAME.FINISH);
    this.notifyClosed();
    return this;
  }

  toWebResponse(): Response {
    return new Response(this.bodyStream, {
      status: this.statusCode,
      headers: Object.fromEntries(this.responseHeaders),
    });
  }

  private flushBufferedChunks(): void {
    if (!this.streamController) {
      return;
    }

    for (const chunk of this.bufferedChunks) {
      this.streamController.enqueue(chunk);
    }
    this.bufferedChunks.length = 0;
  }

  private notifyClosed(): void {
    if (this.closeNotified) {
      return;
    }

    this.closeNotified = true;
    this.notifyRequestClosed();
    this.emit(EVENT_NAME.CLOSE);
  }
}

export async function forwardToHttpSurface(input: ForwardToHttpSurfaceInput): Promise<Response> {
  const nodeRequest = await createNodeRequest(input);
  const nodeResponse = new NodeResponseBridge(() => {
    nodeRequest.emit(EVENT_NAME.CLOSE);
  });

  await input.surface.handleRequest(
    nodeRequest as IncomingMessage,
    nodeResponse as unknown as ServerResponse<IncomingMessage>,
  );

  return nodeResponse.toWebResponse();
}
