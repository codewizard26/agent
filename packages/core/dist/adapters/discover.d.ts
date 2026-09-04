import { type BoardsConfig } from "./index.js";
export type Provider = "greenhouse" | "lever" | "ashby";
export type ProbeFn = (provider: Provider, token: string) => Promise<boolean>;
/** Plausible board tokens for a company name — providers use varied conventions. */
export declare function candidateTokens(companyName: string): string[];
/**
 * A 200 means the board exists; a 404 means this company is not on this provider.
 *
 * Ashby is the exception and must go through GraphQL. Its hosted board URL is a
 * client-rendered SPA that returns HTTP 200 for ANY string — probing it by status
 * code accepted "canada", "retail", and "notarealcompanyxyz123" as real boards.
 * Only a non-empty jobPostings array proves the org exists.
 */
export declare function probeBoardToken(provider: Provider, token: string): Promise<boolean>;
export declare function discoverBoards(companyNames: string[], existing: BoardsConfig, probe?: ProbeFn): Promise<BoardsConfig>;
