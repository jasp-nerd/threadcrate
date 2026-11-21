<script lang="ts">
  import AppIcon from '../../ui/AppIcon.svelte';
  import Glyph from '../../ui/Glyph.svelte';
  import Icon from '../../ui/Icon.svelte';
  import Logo from '../../ui/Logo.svelte';
</script>

<!-- A 7-second loop drawn in CSS: on a Reddit thread the cursor clicks Threadcrate
     in the toolbar and its popup opens. Export also sits beside Share in the
     post's row. With reduced motion it holds the frame with the popup open. -->
<div
  class="demo"
  role="img"
  aria-label="On a Reddit thread, Threadcrate's toolbar icon is clicked and its popup opens. An Export button also sits beside Share under the post."
>
  <div class="chrome">
    <i></i><i></i><i></i>
    <span class="url">reddit.com/r/BalconyGardens/comments/…</span>
    <span class="tool"><Icon name="puzzle" /></span>
    <span class="tool press"
      ><AppIcon size={18} /><svg class="cursor" viewBox="0 0 24 24" aria-hidden="true"
        ><path
          d="M4 2l16 9-7 2-3 7z"
          fill="#14202f"
          stroke="#fff"
          stroke-width="1.5"
          stroke-linejoin="round"
        /></svg
      ></span
    >
  </div>
  <div class="page">
    <div class="nav">
      <i style:width="70%"></i><i style:width="55%"></i><i style:width="62%"></i>
    </div>
    <div class="post">
      <span class="sub">r/BalconyGardens</span>
      <strong>First harvest from my 2 m² balcony this year</strong>
      <i style:width="92%"></i><i style:width="80%"></i>
      <span class="actions">
        <span class="act">1.8k</span>
        <span class="act">213</span>
        <span class="act">Share</span>
        <span class="act export"><Glyph size={11} />Export</span>
      </span>
      <i class="c" style:width="84%"></i><i class="c" style:width="70%"></i>
      <i class="c reply" style:width="66%"></i>
    </div>
    <div class="popup">
      <span class="head"><AppIcon size={16} /><b>Threadcrate</b></span>
      <span class="what">First harvest from my 2 m² balcony…</span>
      <span class="go"><Logo size={16} looping />Export thread</span>
    </div>
  </div>
</div>

<style>
  .demo {
    position: absolute;
    top: 44px;
    left: 40px;
    right: 40px;
    height: 330px;
    border-radius: 16px;
    background: #fff;
    color: #14202f;
    overflow: hidden;
    display: grid;
    grid-template-rows: 38px 1fr;
    box-shadow: 0 18px 44px rgb(120 30 0 / 28%);
    font-family: var(--font-ui);
  }
  .chrome {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    background: #f1f3f6;
  }
  .chrome > i {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #c9cfd8;
  }
  .url {
    margin: 0 4px 0 8px;
    flex: 1;
    min-width: 0;
    height: 24px;
    padding: 0 10px;
    border-radius: 999px;
    background: #fff;
    font-size: 11px;
    line-height: 24px;
    color: #5f6978;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .tool {
    position: relative;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 7px;
    color: #5f6978;
  }
  .tool :global(svg.i) {
    width: 16px;
    height: 16px;
  }
  .tool.press {
    background: #e3e7ed;
  }
  .cursor {
    position: absolute;
    left: 55%;
    top: 55%;
    width: 22px;
    height: 22px;
  }
  .page {
    position: relative;
    display: grid;
    grid-template-columns: 84px 1fr;
  }
  .nav {
    border-right: 1px solid #e5e7eb;
    padding: 14px 10px;
    display: grid;
    align-content: start;
    gap: 10px;
  }
  .nav i,
  .post i {
    display: block;
    height: 9px;
    border-radius: 5px;
    background: #e9edf2;
  }
  .post {
    padding: 14px 16px;
    display: grid;
    align-content: start;
    gap: 9px;
  }
  .sub {
    font-size: 11px;
    color: #5f6978;
  }
  .post strong {
    font-size: 15px;
    line-height: 1.25;
  }
  /* The post's row of Reddit buttons, with Export after Share. */
  .actions {
    display: flex;
    gap: 6px;
    margin: 2px 0 6px;
  }
  .act {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 10px;
    border-radius: 999px;
    background: #e5ebee;
    font-size: 11px;
    font-weight: 600;
  }
  .export {
    box-shadow: 0 0 0 2px #ff4500;
  }
  .post i.c {
    background: #f1f3f6;
  }
  .post i.reply {
    margin-left: 18px;
  }
  .popup {
    position: absolute;
    top: 4px;
    right: 8px;
    width: 200px;
    padding: 10px 12px 12px;
    border-radius: 12px;
    background: #fff;
    box-shadow: 0 12px 30px rgb(20 32 47 / 24%);
    display: grid;
    gap: 8px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }
  .what {
    font-size: 12px;
    font-weight: 700;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .go {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 30px;
    border-radius: 999px;
    background: #d93a00;
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    --brand: #fff;
    --brand-pale: rgb(255 255 255 / 40%);
  }

  @media (prefers-reduced-motion: no-preference) {
    .cursor {
      animation: cursor 7s infinite;
    }
    .tool.press {
      animation: press 7s infinite;
    }
    .popup {
      animation: popup 7s infinite;
    }
  }
  @keyframes cursor {
    0%,
    8% {
      transform: translate(-260px, 160px);
    }
    28%,
    100% {
      transform: translate(0, 0);
    }
  }
  @keyframes press {
    0%,
    30% {
      transform: scale(1);
    }
    32% {
      transform: scale(0.9);
    }
    35%,
    100% {
      transform: scale(1);
    }
  }
  @keyframes popup {
    0%,
    36% {
      opacity: 0;
      transform: translateY(-8px);
    }
    40%,
    92% {
      opacity: 1;
      transform: none;
    }
    97%,
    100% {
      opacity: 0;
      transform: translateY(-8px);
    }
  }
</style>
