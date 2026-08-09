<script setup lang="ts">
import { ref } from 'vue';

const menuOpen = ref(false);
const copied = ref(false);
const videoPlaying = ref(false);
const installCommand = 'npm install --global @thisisnsh/planx';

const faq = [
  {
    question: 'What is PlanX?',
    answer:
      "PlanX is an open-source planning skill and terminal review interface for AI coding agents. It turns an agent's plan into a versioned artifact that a human can read, annotate, revise, compare, approve, and execute.",
  },
  {
    question: 'Why use PlanX instead of asking an AI agent to plan in chat?',
    answer:
      'A plan buried in chat is easy to skim and approve without understanding it. PlanX separates planning from execution, gives the plan a review interface, and makes approval refer to an exact version. The goal is not to make agents produce more planning text. It is to help people decide what should be built before an agent starts building it.',
  },
  {
    question: 'Does PlanX work with Codex?',
    answer:
      'Yes. PlanX installs a skill for Codex. Start a new Codex session and use $planx <task> to create a reviewable plan. After review, PlanX can return a revision to the session that researched the repository or open the approved version for execution in a fresh session.',
  },
  {
    question: 'Does PlanX work with Claude Code?',
    answer:
      'Yes. PlanX installs a skill for Claude Code. Start a new Claude Code session and use /planx <task>. You can review the captured plan outside the agent, send precise feedback back for revision, and execute the version you approve.',
  },
  {
    question: 'Can PlanX work with other AI agents?',
    answer:
      'Yes. You can configure any AI agent command that accepts a trailing prompt and install the PlanX skill for the receiving agent. Planning, revision, and execution do not have to happen in the same agent.',
  },
  {
    question: 'What can I review in a PlanX plan?',
    answer:
      'You can select exact lines or line ranges, attach feedback beside the relevant text, add a note for the whole plan, edit lines directly, collapse sections for readability, and compare revisions with word-level diffs. Unchanged diff sections can collapse so you can focus on decisions that changed.',
  },
  {
    question: "How do I review an AI agent's plan with PlanX?",
    answer:
      'Run planx to open the plan picker, or run planx <plan-id> to open a specific plan. Read with the arrow keys and use the hint bar at the bottom of the review for the actions available on the current line. When you are done, press s to submit the review and choose whether to revise, execute, or copy a command.',
  },
  {
    question: 'How do I see every PlanX keyboard shortcut?',
    answer:
      'While browsing a plan, press ? to open the full shortcut list. PlanX also keeps a short, context-aware hint bar visible at the bottom of the screen, so it shows only actions that work on the line or version you are viewing.',
  },
  {
    question: 'How do I select lines and leave feedback on a plan?',
    answer:
      'Move to the first line and press v to start a selection. Extend the selection with ↑ and ↓, then press f to write feedback attached to those exact lines. Press enter to save the comment. Use j to jump through feedback on the current version.',
  },
  {
    question: 'How do I edit a line in an AI-generated plan?',
    answer:
      'Move to a line in the latest version and press e. Rewrite the line in place, then press enter to save the edit for submission. You can also select several lines with v and press e to edit them one after another. Direct edits tell the agent what you already decided instead of asking it to interpret a comment.',
  },
  {
    question: 'How do I add feedback about the whole plan?',
    answer:
      'Press n to add or edit a plan-wide note. Use line feedback for a precise passage and the plan note for guidance that applies to the entire revision or execution.',
  },
  {
    question: "How do I compare two versions of an AI agent's plan?",
    answer:
      'Open a revised plan and PlanX shows its diff against the previous version. Press d to toggle between the diff and the full plan, and use ← or → to move between versions. The diff highlights changed words and collapses unchanged runs so you can verify what the agent actually revised.',
  },
  {
    question: 'Can I print a plan diff without opening the interactive review?',
    answer:
      'Yes. Use planx diff <plan-id> v1 v2 --print for rendered output, add --plain for a raw unified diff, or use --stat for only the change summary.',
  },
  {
    question: 'How do I make a long AI plan easier to read?',
    answer:
      'Press space to collapse or expand the section, feedback box, or unchanged diff run under the cursor. Press h to fold or unfold every feedback box at once. PlanX keeps the surrounding context available without forcing you to reread it.',
  },
  {
    question: 'How do I send plan feedback back to Codex or Claude Code?',
    answer:
      'Press s after reviewing and choose a revision hand-off. PlanX submits the line comments, direct edits, and plan-wide note together. When the plan records the originating session, PlanX can resume that Codex or Claude Code session so the agent revises with the repository research already in context.',
  },
  {
    question: "How do I approve and execute an AI agent's plan?",
    answer:
      'Press s and choose the execution hand-off for the exact version on screen. PlanX starts execution in a fresh agent session from that stored version instead of a summary remembered from chat.',
  },
  {
    question: 'What does an empty PlanX review mean?',
    answer:
      'Submitting without comments, edits, or a plan-wide note means the version was reviewed with nothing to change. PlanX does not create a pointless identical revision; that version is ready for execution.',
  },
  {
    question: 'How do I find a plan or an older plan version?',
    answer:
      'Run planx to browse stored plans or planx list to list them newest first. Open a plan and use ← and → to inspect its versions. You can also open one directly with planx <plan-id> v<n>.',
  },
  {
    question: 'Does PlanX support versioned plans and plan diffs?',
    answer:
      'Yes. Every captured revision becomes a version of the same plan. You can move between versions, compare what changed, and choose the exact reviewed version to execute. Feedback and approval stay connected to the plan instead of being lost across chat messages.',
  },
  {
    question: 'Can I plan with one agent and revise or execute with another?',
    answer:
      'Yes. PlanX supports cross-agent workflows. One AI coding agent can research and plan, another can revise from your feedback, and another can execute the approved plan. Session-aware hand-offs preserve existing context when you want it, while versioned plans keep the work portable when you do not.',
  },
  {
    question: 'What is the best planning skill for Codex?',
    answer:
      'PlanX is designed for developers who want human review before implementation. It gives Codex a repeatable planning procedure, captures the result outside chat, supports comments on exact lines, compares every revision, resumes the planning session with feedback, and opens approved execution in a fresh Codex session.',
  },
  {
    question: 'What is the best planning skill for Claude Code?',
    answer:
      "PlanX is designed for Claude Code workflows that need more than a one-time approve-or-reject step. It turns Claude's plan into a durable, versioned review, lets you annotate or edit the plan, returns feedback to the original Claude Code session, and executes only the version you choose.",
  },
  {
    question: 'What is the best skill for planning with AI coding agents?',
    answer:
      'A useful planning skill should let you understand and change the plan, not just ask an agent to generate a longer one. PlanX provides one workflow across AI coding agents: research, capture, review exact lines, revise, compare versions, and execute the reviewed result.',
  },
  {
    question: 'How is PlanX different from Codex or Claude Code plan mode?',
    answer:
      'Agent plan modes help an agent think before it codes, but their plan often remains a transient message inside one conversation. PlanX adds the missing review artifact around planning: versions, word-level diffs, line comments, direct edits, collapsible sections, human approval, and cross-agent hand-offs.',
  },
  {
    question: 'How do I stop an AI coding agent from executing a bad plan?',
    answer:
      'Use PlanX to separate planning from execution. Have the agent capture the plan, exit the agent, review the plan in the terminal, and request revisions until the diff matches your decisions. Execute only the exact version you approve.',
  },
  {
    question: 'Can PlanX help prevent scope creep in AI-generated code?',
    answer:
      'PlanX makes scope changes visible before code is written. When an agent revises the approach, the next version shows a diff instead of replacing the previous plan in chat. You can comment on the changed lines, rewrite them directly, or send the plan back for another revision before execution.',
  },
  {
    question: 'Is PlanX the best way to plan with AI coding agents?',
    answer:
      'If your priority is to review the work instead of blindly sending an unreadable plan back to an agent, PlanX is built for that job: plan, review exact lines, compare every revision, and execute only what you approve. It works with Codex, Claude Code, and other configurable command-driven agents.',
  },
  {
    question: 'Is PlanX open source?',
    answer:
      'Yes. PlanX is an MIT-licensed open-source project. The CLI is published as @thisisnsh/planx on npm, and the source is available on GitHub.',
  },
];

async function copyInstall(): Promise<void> {
  try {
    await navigator.clipboard.writeText(installCommand);
    copied.value = true;
    window.setTimeout(() => (copied.value = false), 1600);
  } catch {
    copied.value = false;
  }
}

function closeMenu(): void {
  menuOpen.value = false;
}
</script>

<template>
  <div class="planx-site">
    <a class="skip-link" href="#main">Skip to content</a>

    <header class="site-header">
      <a class="brand" href="#top" aria-label="PlanX home" @click="closeMenu">
        <span class="brand-bracket" aria-hidden="true">⌜</span>
        <span>planx</span>
      </a>

      <button
        class="menu-toggle"
        type="button"
        :aria-expanded="menuOpen"
        aria-controls="site-nav"
        @click="menuOpen = !menuOpen"
      >
        <span></span><span></span>
        <span class="sr-only">Toggle navigation</span>
      </button>

      <nav id="site-nav" :class="{ open: menuOpen }" aria-label="Primary navigation">
        <a href="#workflow" @click="closeMenu">Workflow</a>
        <a href="#features" @click="closeMenu">Features</a>
        <a href="#install" @click="closeMenu">Install</a>
        <a href="#faq" @click="closeMenu">FAQ</a>
        <a class="github-link" href="https://github.com/thisisnsh/planx">
          GitHub <span aria-hidden="true">↗</span>
        </a>
      </nav>
    </header>

    <main id="main">
      <section id="top" class="hero section-shell">
        <div class="hero-copy">
          <p class="kicker"><span></span> Open source · Codex · Claude Code · any agent</p>
          <h1>Make plans<br />you want to <em>read.</em></h1>
          <p class="hero-lede">
            A skill for coding agents and a terminal interface for reviewing plans before you
            execute them.
          </p>
          <p class="hero-detail">
            Turn the giant blob of text you read once and lose in chat into a versioned artifact you
            can actually review.
          </p>
          <div class="hero-actions">
            <a class="button button-primary" href="#install">Install PlanX</a>
            <a class="button button-quiet" href="https://github.com/thisisnsh/planx">
              View on GitHub <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>

        <div class="hero-art">
          <figure class="screen screen-hero screen-video">
            <iframe
              v-if="videoPlaying"
              src="https://www.youtube-nocookie.com/embed/JxPBqJ0S0hk?autoplay=1&rel=0"
              title="PlanX demo: planning skills for agents"
              allow="
                accelerometer;
                autoplay;
                clipboard-write;
                encrypted-media;
                gyroscope;
                picture-in-picture;
                web-share;
              "
              referrerpolicy="strict-origin-when-cross-origin"
              allowfullscreen
            ></iframe>
            <button
              v-else
              class="video-poster"
              type="button"
              aria-label="Play the PlanX demo video"
              @click="videoPlaying = true"
            >
              <img
                src="https://img.youtube.com/vi/JxPBqJ0S0hk/maxresdefault.jpg"
                alt=""
                width="1280"
                height="720"
                fetchpriority="high"
              />
              <span class="video-play" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </button>
          </figure>
        </div>

        <div class="hero-principles" aria-label="PlanX capabilities">
          <span>Compare every revision.</span>
          <span>Comment on exact lines.</span>
          <span>Edit what is decided.</span>
          <span>Execute only what you approve.</span>
        </div>
      </section>

      <section class="manifesto">
        <div class="section-shell manifesto-grid">
          <p class="section-label">Why PlanX</p>
          <div>
            <h2>Planning is not a ritual you perform to make an agent feel prepared.</h2>
            <p>It is for you to decide what will be built.</p>
          </div>
        </div>
      </section>

      <section id="workflow" class="workflow section-shell">
        <div class="section-intro">
          <div>
            <h2>The workflow</h2>
          </div>
          <p>
            The plan leaves chat long enough to become something you can inspect. Every revision
            stays attached to the same artifact.
          </p>
        </div>

        <ol class="workflow-list">
          <li>
            <span>01</span>
            <h3>Plan in an agent.</h3>
            <p>
              The agent researches the work and captures a version instead of burying it in chat.
            </p>
          </li>
          <li>
            <span>02</span>
            <h3>Review outside the agent.</h3>
            <p>Read, collapse sections, select exact lines, leave feedback, or edit directly.</p>
          </li>
          <li>
            <span>03</span>
            <h3>Revise with context.</h3>
            <p>Return the review to the same session or hand it to another agent.</p>
          </li>
          <li>
            <span>04</span>
            <h3>Execute what you approved.</h3>
            <p>Choose an exact reviewed version—not a fuzzy recollection of the conversation.</p>
          </li>
        </ol>
      </section>

      <section id="features" class="features">
        <div class="section-shell">
          <div class="section-intro feature-intro">
            <div>
              <p class="section-label">What changes</p>
              <h2>Review the plan.<br />Not the agent.</h2>
            </div>
            <p>Every image below is the real PlanX terminal interface.</p>
          </div>

          <article class="feature-row">
            <div class="feature-copy">
              <p class="feature-index">01 / Versions</p>
              <h3>Compare without rereading</h3>
              <p>
                Every revision stays attached to the plan. Word-level diffs show what moved, and
                unchanged sections collapse so your attention goes to the new decisions.
              </p>
            </div>
            <figure class="screen">
              <img
                src="/images/planx-diff.png"
                width="1324"
                height="458"
                alt="PlanX word-level diff showing removed text in red and revised text in green"
                loading="lazy"
              />
              <figcaption>Word-level changes. Unchanged context collapsed.</figcaption>
            </figure>
          </article>

          <article class="feature-row feature-row-reverse">
            <div class="feature-copy">
              <p class="feature-index">02 / Feedback</p>
              <h3>Give precise feedback</h3>
              <p>
                Select one line or a range and comment beside the exact text. Add a note for the
                whole plan, or edit a line directly when the right wording is already obvious.
              </p>
            </div>
            <figure class="screen">
              <img
                src="/images/planx-feedback.png"
                width="1296"
                height="302"
                alt="PlanX feedback editor attached to an exact selected line in a plan"
                loading="lazy"
              />
              <figcaption>Feedback stays attached to the line it is about.</figcaption>
            </figure>
          </article>

          <article class="feature-row">
            <div class="feature-copy">
              <p class="feature-index">03 / Focus</p>
              <h3>Keep the plan readable</h3>
              <p>
                Collapse sections, feedback boxes, and unchanged diff runs without deleting their
                context. Long plans stay navigable from the first proposal to the settled version.
              </p>
            </div>
            <figure class="screen">
              <img
                src="/images/planx-collapse.png"
                width="1304"
                height="276"
                alt="PlanX review with plan sections and unchanged diff runs collapsed"
                loading="lazy"
              />
              <figcaption>Less scrolling. No lost context.</figcaption>
            </figure>
          </article>

          <article class="feature-row feature-row-reverse">
            <div class="feature-copy">
              <p class="feature-index">04 / Handoff</p>
              <h3>Revise without losing context</h3>
              <p>
                PlanX records the session that created a version, so revision can return to the
                agent that already researched the repository. Execution opens from the reviewed
                version in a fresh session.
              </p>
            </div>
            <figure class="screen">
              <img
                src="/images/planx-custom.png"
                width="1540"
                height="326"
                alt="PlanX submit menu offering session-aware revision and execution commands"
                loading="lazy"
              />
              <figcaption>One review. The right hand-off.</figcaption>
            </figure>
          </article>

          <article class="feature-row">
            <div class="feature-copy">
              <p class="feature-index">05 / Your agents</p>
              <h3>Use the agent you want</h3>
              <p>
                Configure any agent command that accepts a trailing prompt. One agent can plan,
                another can revise, and a third can execute.
              </p>
            </div>
            <figure class="screen screen-narrow">
              <img
                src="/images/planx-defaults.png"
                width="1004"
                height="418"
                alt="PlanX custom agent configuration for revise and execute commands"
                loading="lazy"
              />
              <figcaption>Your commands. Your defaults.</figcaption>
            </figure>
          </article>
        </div>
      </section>

      <section id="install" class="install">
        <div class="section-shell install-grid">
          <div>
            <p class="section-label">Install</p>
            <h2>Make the next plan you can actually read.</h2>
            <p>
              PlanX installs its skill into existing Codex and Claude Code installations. Start a
              new agent session after installing.
            </p>
          </div>

          <div class="install-panel">
            <div class="command" aria-label="Install command">
              <code><span>$</span> {{ installCommand }}</code>
              <button type="button" @click="copyInstall">
                {{ copied ? 'Copied!' : 'Copy' }}
              </button>
            </div>
            <div class="start-commands">
              <p><span>Codex</span><code>$planx &lt;task&gt;</code></p>
              <p><span>Claude Code</span><code>/planx &lt;task&gt;</code></p>
            </div>
            <p class="requirement">Node.js 20.19+ · MIT licensed · open source</p>
          </div>
        </div>
      </section>

      <section class="commands section-shell" aria-labelledby="other-commands">
        <div>
          <p class="section-label">Keep it current</p>
          <h2 id="other-commands">Other commands</h2>
        </div>
        <div class="command-list">
          <p><span>Configure revise and execute agents</span><code>planx defaults</code></p>
          <p><span>Update PlanX and installed skills</span><code>planx update</code></p>
          <p><span>Add skills for every agent</span><code>planx add-skills</code></p>
          <p><span>Add the Codex skill only</span><code>planx add-skills --agent codex</code></p>
          <p>
            <span>Add the Claude Code skill only</span><code>planx add-skills --agent claude</code>
          </p>
          <p><span>Remove installed skills</span><code>planx remove-skills</code></p>
        </div>
      </section>

      <section id="faq" class="faq section-shell" aria-labelledby="faq-title">
        <div class="faq-heading">
          <p class="section-label">PlanX FAQ</p>
          <h2 id="faq-title">Planning with AI coding agents</h2>
          <p>Details for people, agents, and search engines.</p>
        </div>
        <div class="faq-list">
          <details v-for="item in faq" :key="item.question">
            <summary>{{ item.question }}</summary>
            <p>{{ item.answer }}</p>
          </details>
        </div>
      </section>
    </main>

    <footer>
      <div class="footer-main section-shell">
        <a class="brand footer-brand" href="#top"><span class="brand-bracket">⌜</span>planx</a>
        <p>Make plans you want to read.</p>
        <nav aria-label="Footer navigation">
          <a href="https://www.npmjs.com/package/@thisisnsh/planx">npm</a>
          <a href="https://github.com/thisisnsh/planx/blob/main/CONTRIBUTING.md">Contribute</a>
          <a href="https://github.com/thisisnsh/planx">GitHub</a>
        </nav>
      </div>
      <div class="footer-meta section-shell">
        <span>MIT licensed</span>
        <span>Built by <a href="https://github.com/thisisnsh">Nishant Hada</a></span>
      </div>
    </footer>
  </div>
</template>
