# The progress screen, and why it looks like this

An export takes from ten seconds to over an hour. Its speed is set by Reddit's request budget (about 225 requests per 10 minutes logged out), not by the network. This page records what research and established products say about long waits, and what the export page does as a result. Code: `src/engine/eta.ts` (time left), `src/reddit/pacing.ts` (pace), `src/engine/progress-view.ts` (wording), `src/entrypoints/export/Running.svelte` (layout).

## What the evidence says

- **Show a determinate bar, and say where in the job you are.** People prefer percent-done indicators (Myers 1985) and wait up to about three times longer with one (Nah 2004). Over 10 seconds, show progress and let people leave (Nielsen, *Response Times: The 3 Important Limits*). Telling people their position in a queue cut hang-ups more than music or apologies did (Munichor & Rafaeli 2007).
- **Explain waits.** Unexplained and uncertain waits feel longer (Maister 1985). Microsoft's guidelines: never advance the bar when nothing is happening, and explain why progress slowed. Apple's: keep it moving, and if it stalls, say why.
- **Pauses late in a job feel worst; steady or speeding-up progress feels fastest** (Harrison et al. 2007, *Rethinking the progress bar*). Many small steps feel faster than a few big jumps (Ziat et al. 2022). Slow early progress makes people quit (Conrad et al. 2010).
- **Time left: rounded, a little high, and not until it's reliable.** Finishing earlier than estimated pleases far more than finishing later annoys (Caruelle et al. 2023). Microsoft: hide the estimate while it is unreliable, avoid false precision, update at least every 5 seconds. Raymond Chen on the Windows copy dialog: estimates are worst at the start.
- **Show the work being done, calmly.** Seeing what a system is doing raises satisfaction (Buell & Norton 2011, *The labor illusion*). Busy displays, though, draw attention to the time passing (Branaghan & Sanchez 2009).
- **No speed graph.** There's no evidence a throughput graph helps when the user can't act on it. Windows added its graph to show contention between parallel copies, and Steam's graph helps people find bottlenecks. Here the pace is Reddit's, and a graph would mostly draw the pauses.
- **Let people leave and come back.** Microsoft: for tasks over 2 minutes, notify on completion, never steal focus, and put progress first in title text. Label the button "Stop" (not "Cancel") when what's done is kept.

## What the export page does

| Research | On the page |
|---|---|
| Position over raw numbers | "Post 21 of 250 · 1,340 comments so far", and "412 of about 740 comments" for one post. Request counts and Reddit's budget are under Details. |
| Time left in words, leaning high | "About 12 minutes left" (rounded up; to 5 minutes above 10, to 10 minutes above an hour; 5% added), "done around 21:40" for long exports, "Estimating time…" until the job's size is known. |
| A model, not a speed average | Reddit's budget and our pacing are known, so `eta.ts` replays the pacing rules for the requests still needed (posts left × their reported comments × requests per comment, learned as threads finish). A coming pause is in the estimate before it happens. Simulated runs check it (`eta.test.ts`). |
| Steady numbers | Firefox's download rule: the shown time counts down by itself; drops are taken at 30%, rises at 10%, changes under 5 s or 5% are ignored. |
| No long stops, no late pause | `pacing.ts` spends Reddit's budget evenly over each window when the job doesn't fit in it (as PRAW does). When the rest fits, it goes at full speed. Near the edge it chooses the even pace, so a job never ends with a surprise wait. |
| Explain every wait | Pauses for Reddit's limit, "slow down" answers and retries, and any gap of 10 seconds or more, say what's happening in plain words, with an exact countdown. The bar turns amber. |
| A bar that tells the truth | The bar is the share of the time spent (time so far ÷ time so far plus time left), so it keeps moving through a pause, which counts toward finishing, and never goes backwards. |
| The work, calmly | One line with the title of the post being loaded. Details (collapsed, remembered) holds Reddit's budget, requests and an activity log. |
| Leaving and coming back | "42% ·" or "Paused ·" first in the tab title, the percentage on the toolbar icon, a notification when an export ends while its tab is in the background. Chrome asks before closing the tab mid-export, but only if you've clicked in it (browsers' rule for that dialog). |
| Stop keeps the work | "Stop and save (21 posts, 1,340 comments so far)". |
| Accessibility | A progress bar with a spoken description ("Post 21 of 250. About 6 minutes left"), a polite status region that announces only phase changes, pauses and the end, pause shown by icon and text (not just color), no animation with reduced motion. |
| Choosing before waiting | The panel shows how long each choice takes before the export starts (comments: None · Top · Up to 100 · All), from the comment counts the page already shows. |

## References

- Caruelle, D., et al. (2023). On the effects of wait-time estimates on customer satisfaction. *Journal of Retailing*.
- Nah, F. F.-H. (2004). A study on tolerable waiting time: how long are Web users willing to wait? *Behaviour & Information Technology* 23(3).
- Myers, B. A. (1985). The importance of percent-done progress indicators for computer-human interfaces. CHI '85. https://doi.org/10.1145/1165385.317459
- Nielsen, J. (1993). Response Times: The 3 Important Limits. https://www.nngroup.com/articles/response-times-3-important-limits/
- Sherwin, K. (2014). Progress Indicators Make a Slow System Less Insufferable. Nielsen Norman Group. https://www.nngroup.com/articles/progress-indicators/
- Harrison, C., Amento, B., Kuznetsov, S., & Bell, R. (2007). Rethinking the progress bar. UIST '07. https://doi.org/10.1145/1294211.1294231
- Harrison, C., Yeo, Z., & Hudson, S. E. (2010). Faster progress bars. CHI '10. https://doi.org/10.1145/1753326.1753556
- Maister, D. H. (1985). The psychology of waiting lines. In *The Service Encounter*.
- Buell, R. W., & Norton, M. I. (2011). The labor illusion. *Management Science* 57(9). https://doi.org/10.1287/mnsc.1110.1376
- Munichor, N., & Rafaeli, A. (2007). Numbers or apologies? *Journal of Applied Psychology* 92(2). https://doi.org/10.1037/0021-9010.92.2.511
- Branaghan, R. J., & Sanchez, C. A. (2009). Feedback preferences and impressions of waiting. *Human Factors* 51(4). https://doi.org/10.1177/0018720809345684
- Conrad, F. G., Couper, M. P., Tourangeau, R., & Peytchev, A. (2010). The impact of progress indicators on task completion. *Interacting with Computers* 22(5). https://doi.org/10.1016/j.intcom.2010.03.001
- Ziat, M., et al. (2022). *Scientific Reports* 12:10400. https://doi.org/10.1038/s41598-022-14649-1
- Microsoft. Progress Bars (Windows UX guidelines). https://learn.microsoft.com/en-us/windows/win32/uxguide/progress-bars
- Apple. Progress indicators (Human Interface Guidelines). https://developer.apple.com/design/human-interface-guidelines/progress-indicators
- Chen, R. (2004). Why does the copy dialog give such horrible estimates? https://devblogs.microsoft.com/oldnewthing/20040106-00/?p=41193
- Firefox's download time estimate: `DownloadUtils.sys.mjs`. https://github.com/mozilla/gecko-dev/blob/master/toolkit/mozapps/downloads/DownloadUtils.sys.mjs
- prawcore's rate limiting: https://github.com/praw-dev/prawcore/blob/main/prawcore/rate_limit.py
