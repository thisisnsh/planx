<script setup lang="ts">
import { ref } from 'vue';
import FeatureTerminal from './FeatureTerminal.vue';

const menuOpen = ref(false);
const copied = ref(false);
const installCommand = 'npm install --global @thisisnsh/planx';

async function copyInstall(): Promise<void> {
  try {
    await navigator.clipboard.writeText(installCommand);
    copied.value = true;
    window.setTimeout(() => (copied.value = false), 1800);
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
        <span class="brand-cursor" aria-hidden="true"></span>
        <span>PLANX</span>
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
        <a href="#why" @click="closeMenu">Why PlanX</a>
        <a href="#workflow" @click="closeMenu">Workflow</a>
        <a href="#features" @click="closeMenu">Features</a>
        <a href="https://github.com/thisisnsh/planx">GitHub <span aria-hidden="true">↗</span></a>
        <a class="nav-cta" href="#install" @click="closeMenu">Install</a>
      </nav>
    </header>

    <main id="main">
      <section id="top" class="hero">
        <div class="hero-grid" aria-hidden="true"></div>
        <div class="hero-copy">
          <p class="eyebrow">
            <span class="status-dot"></span> Reviewable planning for coding agents
          </p>
          <h1>Stop feeding agents <span>unreadable plans.</span></h1>
          <p class="hero-lede">
            PlanX is a skill and terminal review interface. Turn an agent's plan into a versioned
            artifact, challenge it line by line, and execute only the version you approve.
          </p>
          <div class="hero-actions">
            <a class="button button-primary" href="#install"
              >Get PlanX <span aria-hidden="true">↓</span></a
            >
            <a class="button button-secondary" href="https://github.com/thisisnsh/planx">
              View source <span aria-hidden="true">↗</span>
            </a>
          </div>
          <p class="hero-command" aria-label="Install command">
            <code><span>$</span> {{ installCommand }}</code>
          </p>
        </div>

        <div class="hero-proof">
          <div class="terminal-window">
            <div class="window-chrome" aria-hidden="true">
              <span></span><span></span><span></span>
              <p>planx — review</p>
            </div>
            <img
              src="https://raw.githubusercontent.com/thisisnsh/planx/main/assets/planx-review.png"
              alt="PlanX comparing plan revisions with exact-line feedback, a direct edit, and collapsed context"
            />
          </div>
          <p>
            <span aria-hidden="true">↗</span> Real PlanX review: diff, edit, feedback, and collapsed
            context.
          </p>
        </div>
      </section>

      <section class="agent-strip" aria-label="Supported coding agents">
        <p>One review loop. Your choice of agent.</p>
        <div class="agent-list">
          <span>CODEX SKILL</span><i></i><span>CLAUDE CODE SKILL</span><i></i
          ><span>OTHER AGENT CLIs</span>
        </div>
      </section>

      <section id="why" class="manifesto section-shell">
        <p class="section-index">01 / THE POINT</p>
        <div>
          <h2>A plan is not a prompt.<br /><em>It is a decision.</em></h2>
          <p>
            Agents can generate plausible steps faster than you can read them. That does not make
            the plan correct—or even readable. PlanX gives planning back to the person responsible
            for the outcome: read it, compare it, question it, change it, then approve it.
          </p>
        </div>
      </section>

      <section id="workflow" class="workflow section-shell">
        <div class="section-heading">
          <div>
            <p class="section-index">02 / THE LOOP</p>
            <h2>Plan. Review. Revise. Execute.</h2>
          </div>
          <p>
            The plan leaves chat long enough to become something you can inspect. Every hand-off
            names the plan and exact version.
          </p>
        </div>

        <div class="workflow-track">
          <div class="workflow-line" aria-hidden="true"></div>
          <article>
            <span class="step-dot step-square">01</span>
            <h3>Plan</h3>
            <p>An agent researches the repository and captures the first version.</p>
          </article>
          <article>
            <span class="step-dot">02</span>
            <h3>Review</h3>
            <p>You compare, select lines, leave feedback, add notes, and edit text.</p>
          </article>
          <article>
            <span class="step-dot">03</span>
            <h3>Revise</h3>
            <p>The same agent—or another one—answers the review in a new version.</p>
          </article>
          <article>
            <span class="step-dot step-ring">04</span>
            <h3>Execute</h3>
            <p>An agent builds the exact reviewed version you chose.</p>
          </article>
        </div>
      </section>

      <section id="features" class="features section-shell">
        <div class="section-heading">
          <div>
            <p class="section-index">03 / REVIEW TOOLS</p>
            <h2>Less plan theatre. More actual review.</h2>
          </div>
          <p>
            Everything important stays in the main loop. Maintenance and configuration stay out of
            the way until you need them.
          </p>
        </div>

        <div class="feature-grid">
          <article class="feature feature-wide">
            <div class="feature-copy">
              <span class="feature-number">01</span>
              <h3>Versioned plans with readable diffs</h3>
              <p>
                Keep every revision, move through history, and compare exact word-level changes.
                Unchanged runs collapse so the decision stays visible.
              </p>
            </div>
            <div class="version-visual" aria-hidden="true">
              <div class="plan-version muted"><span>v1</span><i></i><i></i><i></i></div>
              <div class="plan-arrow">→</div>
              <div class="plan-version active">
                <span>v3 ← v2</span><i></i><i></i><i></i><b>review</b>
              </div>
            </div>
          </article>

          <article class="feature">
            <span class="feature-number">02</span>
            <div class="line-visual" aria-hidden="true">
              <span>11 │ rollout at 10%</span>
              <span>12 │ measure errors</span>
              <b>↳ add a rollback gate</b>
            </div>
            <h3>Feedback on exact lines</h3>
            <p>
              Select one line or a range. Comments stay visibly anchored to the text they address.
            </p>
          </article>

          <article class="feature feature-yellow">
            <span class="feature-number">03</span>
            <div class="edit-visual" aria-hidden="true">
              <span><i>−</i> global request limit</span>
              <span><i>+</i> per-user rate limit</span>
            </div>
            <h3>Edit lines. Add a plan-wide note.</h3>
            <p>
              Settle obvious wording yourself and keep broad constraints separate from local
              feedback.
            </p>
          </article>

          <article class="feature">
            <span class="feature-number">04</span>
            <div class="collapse-visual" aria-hidden="true">
              <span>## Approach</span>
              <b>⋯ 18 lines · 2 feedback</b>
              <span>## Validation</span>
            </div>
            <h3>Long plans stay readable</h3>
            <p>
              Collapse sections, feedback, and unchanged diff runs without throwing context away.
            </p>
          </article>

          <article class="feature feature-wide handoff-feature">
            <div class="feature-copy">
              <span class="feature-number">05</span>
              <h3>Revise and execute in any agent</h3>
              <p>
                Resume the agent that wrote the plan, choose another agent through a custom
                hand-off, or copy the exact command yourself. Cross-agent workflows are a feature,
                not a workaround.
              </p>
            </div>
            <div class="handoff-visual" aria-hidden="true">
              <span>CODEX</span><i>plan</i><b>→</b><span>CLAUDE</span><i>revise</i><b>→</b
              ><span>YOUR AGENT</span><i>execute</i>
            </div>
          </article>
        </div>
      </section>

      <section class="proof-section">
        <div class="section-shell">
          <div class="section-heading">
            <div>
              <p class="section-index">04 / SEE THE REVIEW</p>
              <h2>Every claim has a screen.</h2>
            </div>
            <p>
              These are static views of the terminal UI. The two labeled slots are ready for the
              final screenshots when they are available.
            </p>
          </div>

          <div class="proof-group">
            <div class="proof-copy">
              <span>01</span>
              <h3>Point at the text. Say what is wrong.</h3>
              <p>
                Exact-range feedback and direct edits remove the ambiguity from revision prompts.
              </p>
            </div>
            <div class="proof-screens two-up">
              <FeatureTerminal example="feedback" />
              <FeatureTerminal example="editing" />
            </div>
          </div>

          <div class="proof-group">
            <div class="proof-copy">
              <span>02</span>
              <h3>Compare versions without rereading everything.</h3>
              <p>
                History, word-level changes, and collapsed context keep each review round focused.
              </p>
            </div>
            <div class="proof-screens three-up">
              <FeatureTerminal example="diff" />
              <FeatureTerminal example="versions" />
              <FeatureTerminal example="readability" />
            </div>
            <div class="screenshot-placeholder">
              <span>SCREENSHOT PLACEHOLDER / VERSION HISTORY + COMPARE</span>
              <strong>Plan picker with several versions beside the v3 ← v2 review</strong>
              <p>Use this slot for the final version-navigation screenshot.</p>
            </div>
          </div>

          <div class="proof-group">
            <div class="proof-copy">
              <span>03</span>
              <h3>Hand the settled version to the right agent.</h3>
              <p>
                Revision and execution stay tied to an ID and version, even across agent boundaries.
              </p>
            </div>
            <div class="proof-screens one-up">
              <FeatureTerminal example="handoff" />
            </div>
            <div class="screenshot-placeholder">
              <span>SCREENSHOT PLACEHOLDER / CROSS-AGENT HAND-OFF</span>
              <strong>Submit menu with resume, execute, copy, and custom-agent rows</strong>
              <p>Use this slot for the final hand-off screenshot.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="install" class="install section-shell">
        <div class="install-mark" aria-hidden="true"><span>PX</span></div>
        <div class="install-copy">
          <p class="section-index">05 / GET STARTED</p>
          <h2>Make the next plan worth executing.</h2>
          <p>
            Install the CLI and skill, start a new Codex or Claude Code session, and ask for a
            reviewable plan. Other agent CLIs can join through the packaged skill and custom
            hand-offs.
          </p>

          <div class="command" aria-label="Install command">
            <code><span>$</span> {{ installCommand }}</code>
            <button
              type="button"
              :aria-label="copied ? 'Install command copied' : 'Copy install command'"
              @click="copyInstall"
            >
              <span>{{ copied ? 'Copied' : 'Copy' }}</span>
            </button>
          </div>

          <div class="agent-commands">
            <p><strong>Codex</strong><code>$planx &lt;task&gt;</code></p>
            <p><strong>Claude Code</strong><code>/planx &lt;task&gt;</code></p>
          </div>

          <p class="install-note">Requires Node.js 20.19 or newer.</p>
          <a
            class="text-link"
            href="https://github.com/thisisnsh/planx#installation-and-agent-setup"
          >
            Installation, custom agents, and configuration <span aria-hidden="true">→</span>
          </a>
        </div>
      </section>
    </main>

    <footer>
      <div class="footer-brand">
        <strong>PLANX</strong><span>Review the plan. Not the agent.</span>
      </div>
      <div class="footer-links">
        <a href="#install">Install</a>
        <a href="https://www.npmjs.com/package/@thisisnsh/planx">npm</a>
        <a href="https://github.com/thisisnsh/planx/blob/main/CONTRIBUTING.md">Contribute</a>
        <a href="https://github.com/thisisnsh/planx">GitHub</a>
      </div>
      <p>MIT licensed · Built by <a href="https://github.com/thisisnsh">Nishant Hada</a></p>
    </footer>
  </div>
</template>
