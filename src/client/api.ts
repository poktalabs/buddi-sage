// The page's only way to reach the Worker. Decision: one typed interface (ClientApi) built
// on src/shared/api.ts, with two implementations: httpApi (real, same-origin fetch, the
// session cookie rides along) and the mock in mock.ts (?mock=1 on localhost only). Every
// failure becomes an ApiFailure carrying the contract's error code, so screens branch on
// codes, never on status numbers or message text.
import type {
  ApiError,
  CodeRequestBody,
  CodeRequestResponse,
  Me,
  RedeemRequest,
  ReplayRequest,
  ReplayResponse,
  SetJobRequest,
  StartRoundRequest,
  StartRoundResponse,
  VoiceResponse,
} from "../shared/api";

/** Contract error codes, plus two the page produces itself. */
export type FailureCode = string; // an ApiError.error value, "network", or "bad_response"

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: FailureCode,
  ) {
    super(code);
    this.name = "ApiFailure";
  }
}

export interface ClientApi {
  me(): Promise<Me>;
  redeem(req: RedeemRequest): Promise<Me>;
  addVoice(sample: Blob, filename: string): Promise<VoiceResponse>;
  deleteVoice(): Promise<VoiceResponse>;
  /** Sets the target job from a link or pasted post; answers the updated Me. */
  setJob(req: SetJobRequest): Promise<Me>;
  startRound(req: StartRoundRequest): Promise<StartRoundResponse>;
  replay(roundId: string, req: ReplayRequest): Promise<ReplayResponse>;
  /** Fetches Replay audio once. Each fetch is a paid text to speech call. */
  fetchAudio(url: string): Promise<Blob>;
  /** Landing page: asks Mel for a code. */
  requestCode(req: CodeRequestBody): Promise<CodeRequestResponse>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function failureFrom(res: Response): Promise<ApiFailure> {
  let code = "bad_response";
  try {
    const body = (await res.json()) as Partial<ApiError>;
    if (typeof body.error === "string" && body.error) code = body.error;
  } catch {
    // Not JSON: keep bad_response.
  }
  return new ApiFailure(res.status, code);
}

export function httpApi(fetchImpl: FetchLike = (i, init) => fetch(i, init)): ClientApi {
  async function send(path: string, init?: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(path, { credentials: "same-origin", ...init });
    } catch {
      throw new ApiFailure(0, "network");
    }
    if (!res.ok) throw await failureFrom(res);
    return res;
  }

  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await send(path, init);
    try {
      return (await res.json()) as T;
    } catch {
      throw new ApiFailure(res.status, "bad_response");
    }
  }

  const post = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  return {
    me: () => json<Me>("/api/me"),
    redeem: (req) => json<Me>("/api/redeem", post(req)),
    addVoice: (sample, filename) => {
      const form = new FormData();
      form.append("sample", sample, filename);
      return json<VoiceResponse>("/api/voice", { method: "POST", body: form });
    },
    deleteVoice: () => json<VoiceResponse>("/api/voice", { method: "DELETE" }),
    setJob: (req) => json<Me>("/api/job", post(req)),
    startRound: (req) => json<StartRoundResponse>("/api/rounds", post(req)),
    replay: (roundId, req) => json<ReplayResponse>(`/api/rounds/${encodeURIComponent(roundId)}/replay`, post(req)),
    fetchAudio: async (url) => (await send(url)).blob(),
    requestCode: (req) => json<CodeRequestResponse>("/api/requests", post(req)),
  };
}
