import type { NormalizedJob } from "../types.js";
export interface LeverPosting {
    id: string;
    text: string;
    hostedUrl: string;
    applyUrl?: string;
    createdAt: number;
    descriptionPlain?: string;
    workplaceType?: string;
    categories?: {
        location?: string;
        team?: string;
        commitment?: string;
    };
}
export declare function normalizeLever(raw: LeverPosting, token: string): NormalizedJob;
export declare function fetchLeverBoard(token: string): Promise<LeverPosting[]>;
