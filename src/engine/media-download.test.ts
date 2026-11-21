import { expect, test } from 'vitest';
import { audioUrlFromMpd, videoUrlFromMpd } from '../reddit/media';
import { fakeClock, fakeFetch } from '../../tests/support/fake';
import { createRedditClient } from '../reddit/client';
import {
  downloadable,
  downloadPostMedia,
  vredditBase,
  type MediaFailure,
  type MediaFile,
} from './media-download';

// The shape of a v.redd.it DASHPlaylist.mpd (trimmed).
const MPD = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <Representation bandwidth="1200000" height="480" id="1"><BaseURL>DASH_480.mp4</BaseURL></Representation>
      <Representation bandwidth="4000000" height="1080" id="2"><BaseURL>DASH_1080.mp4</BaseURL></Representation>
    </AdaptationSet>
    <AdaptationSet contentType="audio" mimeType="audio/mp4">
      <Representation bandwidth="64000" id="3"><BaseURL>CMAF_AUDIO_64.mp4</BaseURL></Representation>
      <Representation bandwidth="128000" id="4"><BaseURL>CMAF_AUDIO_128.mp4</BaseURL></Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

test('the best video and audio tracks of a DASH playlist', () => {
  expect(videoUrlFromMpd(MPD, 'https://v.redd.it/abc/')).toBe(
    'https://v.redd.it/abc/DASH_1080.mp4',
  );
  expect(audioUrlFromMpd(MPD, 'https://v.redd.it/abc/DASH_1080.mp4')).toBe(
    'https://v.redd.it/abc/CMAF_AUDIO_128.mp4',
  );
  expect(
    audioUrlFromMpd(
      '<MPD><AdaptationSet contentType="video"></AdaptationSet></MPD>',
      'https://v.redd.it/abc/x.mp4',
    ),
  ).toBeNull();
});

test('which media hosts are fetched', () => {
  expect(downloadable('https://i.redd.it/x.jpg')).toBe(true);
  expect(downloadable('https://packaged-media.redd.it/x/pb/m2.mp4?s=1')).toBe(true);
  expect(downloadable('https://i.imgur.com/x.png')).toBe(true);
  expect(downloadable('https://imgur.com/gallery/x')).toBe(false);
  expect(downloadable('http://i.redd.it/x.jpg')).toBe(false);
  expect(downloadable('https://i.redd.it.evil.example/x.jpg')).toBe(false);
  expect(vredditBase('https://v.redd.it/abc123/DASH_720.mp4')).toBe('https://v.redd.it/abc123');
  expect(vredditBase('https://packaged-media.redd.it/abc/pb/x.mp4')).toBeNull();
});

test("a deleted Imgur image is a failure, not Imgur's placeholder saved as the image", async () => {
  const clock = fakeClock();
  const f = fakeFetch((u) =>
    u.hostname === 'i.imgur.com'
      ? {
          body: 'png',
          headers: { 'content-type': 'image/png' },
          url: 'https://i.imgur.com/removed.png',
        }
      : undefined,
  );
  const client = createRedditClient({ fetch: f.fetch, now: clock.now, sleep: clock.sleep });
  const out = { files: [] as MediaFile[], failures: [] as MediaFailure[] };
  await downloadPostMedia(
    {
      id: 'p1',
      subreddit: 'testsub',
      media: [{ type: 'image', url: 'https://i.imgur.com/abc.png' }],
    } as never,
    client,
    (p) => p,
    out,
  );
  expect(out.files).toEqual([]);
  expect(out.failures).toEqual([
    { post_id: 'p1', url: 'https://i.imgur.com/abc.png', reason: 'removed from Imgur' },
  ]);
});
