// What the Export buttons on Reddit's pages show, shared with their components.

/** The look of the Reddit button an Export button sits beside, read from the page. */
export interface Look {
  background: string;
  color: string;
  border: string;
  radius: string;
  height: string;
  font: string;
  size: string;
}

/** Each place's look, by place name ('post', 'subreddit'). */
export const looks = $state<Record<string, Look | null>>({});
