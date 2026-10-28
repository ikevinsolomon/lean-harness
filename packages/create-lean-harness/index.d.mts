export declare function titleOf(slug: string): string;
export declare function slugOf(text: string): string;
/** Copy the template into `dir`, filling in the assistant's name. */
export declare function create(options: { dir: string; name?: string; workspace?: boolean }): Promise<{ name: string; slug: string; version: string }>;
