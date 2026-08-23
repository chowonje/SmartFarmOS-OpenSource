import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const chromePath = await findChromeExecutable();

if (chromePath === null) {
  if (process.env.SMARTFARM_REQUIRE_BROWSER === "1") {
    throw new Error("Chrome/Chromium is required but no executable was found");
  }
  process.stdout.write(
    "PWA browser smoke skipped because Chrome/Chromium is not installed. Set CHROME_PATH or SMARTFARM_REQUIRE_BROWSER=1.\n",
  );
} else {
  await runBrowserSmokeWithPortRetry(chromePath);
}

async function runBrowserSmokeWithPortRetry(executablePath) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await runBrowserSmoke(executablePath);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 2 || !/EADDRINUSE|address already in use/i.test(message)) throw error;
    }
  }
}

async function runBrowserSmoke(executablePath) {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-pwa-browser-"));
  const apiPort = await reserveLoopbackPort();
  const pwaPort = await reserveLoopbackPort();
  let adminPort = await reserveLoopbackPort();
  while (adminPort === apiPort || adminPort === pwaPort) {
    adminPort = await reserveLoopbackPort();
  }
  const pwaUrl = `http://127.0.0.1:${pwaPort}/`;
  const adminUrl = `http://127.0.0.1:${adminPort}/`;
  let launcher = null;
  let chrome = null;
  let cdp = null;
  let launcherOutput = "";

  try {
    launcher = spawn(process.execPath, [
      join(repositoryRoot, "scripts", "run-local-demo.mjs"),
      "--preview",
    ], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        NO_COLOR: "1",
        SMARTFARM_DEMO_PORT: String(apiPort),
        SMARTFARM_PWA_PORT: String(pwaPort),
        SMARTFARM_ADMIN_PORT: String(adminPort),
        SMARTFARM_DEMO_DB_PATH: join(directory, "smartfarm.sqlite"),
        SMARTFARM_DEMO_TELEMETRY_INTERVAL_MS: "3000",
        SMARTFARM_DEMO_COMMAND_POLL_INTERVAL_MS: "100",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    launcher.stdout?.on("data", (chunk) => {
      launcherOutput = appendBounded(launcherOutput, chunk);
    });
    launcher.stderr?.on("data", (chunk) => {
      launcherOutput = appendBounded(launcherOutput, chunk);
    });

    await waitForHttp(pwaUrl, launcher, () => launcherOutput);
    await waitForHttp(adminUrl, launcher, () => launcherOutput);

    const chromeProfile = join(directory, "chrome-profile");
    chrome = spawn(executablePath, [
      "--headless=new",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-extensions",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${chromeProfile}`,
      pwaUrl,
    ], {
      stdio: "ignore",
    });

    const debuggingPort = await waitForDevToolsPort(chromeProfile, chrome);
    const target = await waitForPageTarget(debuggingPort, pwaUrl, chrome);
    cdp = await createCdpClient(target.webSocketDebuggerUrl);
    await cdp.call("Runtime.enable");
    await cdp.call("Page.enable");
    await cdp.call("Network.enable");

    await cdp.waitForTruthy(
      'document.querySelector("[data-testid=nav-operations]") !== null',
      "crop operations navigation",
    );
    await cdp.evaluate('document.querySelector("[data-testid=nav-operations]").click(); true');
    await cdp.waitForTruthy(
      'document.querySelector("[data-testid=operations-cycle-select]")?.querySelectorAll("option").length > 0',
      "crop-cycle selection",
    );
    await cdp.waitForValue(
      'document.querySelectorAll("[data-testid=operations-area-card]").length',
      2,
      "two assigned growing areas",
    );
    assert.equal(
      await cdp.evaluate('document.querySelector("#operations-title")?.textContent?.trim().length > 0'),
      true,
    );
    await cdp.waitForTruthy(
      'document.querySelector("[data-testid=operations-alarm-summary]") !== null',
      "crop operations active-alarm summary",
    );
    await cdp.waitForValue(
      'document.querySelectorAll("[data-testid=operations-comparison-area]").length',
      2,
      "two area telemetry comparison cards",
      12_000,
    );
    await cdp.waitForValue(
      'document.querySelectorAll("[data-testid=operations-comparison-area] [data-testid^=operations-comparison-metric-]").length',
      8,
      "four comparison metrics for both areas",
    );
    await cdp.waitForTruthy(
      `Array.from(document.querySelectorAll("[data-testid=operations-comparison-value]"))
        .length === 8 && Array.from(document.querySelectorAll("[data-testid=operations-comparison-value]"))
        .every((element) => element.textContent?.trim() !== "--")`,
      "live values in every area comparison metric",
      12_000,
    );
    await cdp.waitForValue(
      'document.querySelectorAll("[data-testid=operations-comparison-area] .comparison-sparkline").length',
      8,
      "recent trend evidence for every area metric",
      12_000,
    );
    assert.equal(
      await cdp.evaluate(`Array.from(document.querySelectorAll("[data-testid^=operations-comparison-freshness-]"))
        .every((element) => element.textContent?.includes("최신"))`),
      true,
    );
    const initialWaterLevels = await cdp.evaluate(`Array.from(
      document.querySelectorAll("[data-testid=operations-comparison-area]"),
    ).map((card) => Number.parseFloat(
      card.querySelector("[data-testid=operations-comparison-metric-water_level] [data-testid=operations-comparison-value]")
        ?.textContent ?? "NaN",
    ))`);
    assert.equal(initialWaterLevels.length, 2);
    assert.equal(initialWaterLevels.every(Number.isFinite), true);
    assert.equal(
      initialWaterLevels[0] > initialWaterLevels[1],
      true,
      "The deterministic comparison should identify bed 2 as the lower-water area",
    );

    await cdp.waitForTruthy(
      'document.querySelector("[data-testid=nav-alarms]") !== null',
      "alarm-center navigation",
    );
    await cdp.evaluate('document.querySelector("[data-testid=nav-alarms]").click(); true');
    await cdp.waitForValue(
      'document.querySelectorAll("[data-testid=alarm-active-card]").length',
      1,
      "one active low-water alarm",
    );
    assert.equal(
      await cdp.evaluate('document.querySelector("[data-testid=alarm-active-card] [data-testid=alarm-state]")?.textContent'),
      "활성",
    );
    assert.equal(
      await cdp.evaluate('document.querySelector("[data-testid=alarm-active-card] [data-testid=alarm-ack-status]")?.textContent'),
      "미확인",
    );
    await cdp.evaluate('document.querySelector("[data-testid=alarm-active-card] [data-testid=alarm-acknowledge]").click(); true');
    await cdp.waitForValue(
      'document.querySelector("[data-testid=alarm-active-card] [data-testid=alarm-ack-status]")?.textContent',
      "확인됨",
      "acknowledged active alarm",
    );
    await cdp.waitForValue(
      'document.querySelectorAll("[data-testid=audit-event]").length',
      1,
      "one alarm acknowledgement audit event",
    );
    await cdp.waitForValue(
      'document.querySelectorAll("[data-testid=alarm-cleared-card]").length',
      1,
      "cleared low-water alarm history",
      15_000,
    );
    assert.equal(
      await cdp.evaluate('document.querySelector("[data-testid=alarm-cleared-card] [data-testid=alarm-state]")?.textContent'),
      "해제",
    );
    assert.equal(
      await cdp.evaluate('document.querySelector("[data-testid=alarm-cleared-card] [data-testid=alarm-ack-status]")?.textContent'),
      "확인됨",
    );
    assert.equal(
      await cdp.evaluate('document.querySelectorAll("[data-testid=alarm-active-card]").length'),
      0,
    );

    await cdp.evaluate('document.querySelector("[data-testid=nav-operations]").click(); true');
    await cdp.waitForTruthy(
      'document.querySelector("[data-testid=irrigation-strategy-select]")?.value === "strategy:basil-recovery@2"',
      "approved irrigation strategy selection",
      12_000,
    );
    assert.equal(
      await cdp.evaluate(`(() => {
        const text = document.querySelector('[data-testid=irrigation-safety-note]')?.textContent ?? '';
        return text.includes('5초') && text.includes('최종 off') && text.includes('물리 인터록');
      })()`),
      true,
      "Timed strategy must show its final-off and physical-safety boundary",
    );
    await cdp.evaluate(`(() => {
      const input = document.querySelector(
        '[data-testid=irrigation-area-option] input[value="area:bed-1"]',
      );
      if (!(input instanceof HTMLInputElement)) return false;
      input.click();
      return true;
    })()`);
    await cdp.waitForTruthy(
      `(() => {
        const selected = document.querySelector(
          '[data-testid=irrigation-area-option] input[value="area:bed-1"]',
        );
        const confirmation = document.querySelector(
          '[data-testid=irrigation-application-confirmation]',
        );
        const apply = document.querySelector('[data-testid=irrigation-apply]');
        return selected?.checked === true
          && confirmation?.textContent?.includes('최근 저수위 알람 대상이 아닙니다') === true
          && apply?.disabled === true;
      })()`,
      "non-alarm irrigation target requires explicit override confirmation",
    );
    await cdp.evaluate(`(() => {
      const previous = document.querySelector(
        '[data-testid=irrigation-area-option] input[value="area:bed-1"]',
      );
      const input = document.querySelector(
        '[data-testid=irrigation-area-option] input[value="area:bed-2"]',
      );
      if (!(previous instanceof HTMLInputElement) || !(input instanceof HTMLInputElement)) return false;
      previous.click();
      input.click();
      return true;
    })()`);
    await cdp.waitForTruthy(
      `(() => {
        const selected = document.querySelector(
          '[data-testid=irrigation-area-option] input[value="area:bed-2"]',
        );
        const other = document.querySelector(
          '[data-testid=irrigation-area-option] input[value="area:bed-1"]',
        );
        const apply = document.querySelector('[data-testid=irrigation-apply]');
        const evidence = Array.from(document.querySelectorAll('[data-testid=irrigation-area-option]'))
          .find((option) => option.querySelector('input')?.value === 'area:bed-2')
          ?.querySelector('[data-testid=irrigation-target-evidence]');
        return selected?.checked === true
          && other?.checked === false
          && evidence?.textContent?.includes('저수위 알람') === true
          && apply?.disabled === true;
      })()`,
      "one lower-water irrigation target awaiting confirmation",
    );
    await cdp.evaluate(`(() => {
      const input = document.querySelector(
        '[data-testid=irrigation-application-confirmation] input',
      );
      if (!(input instanceof HTMLInputElement)) return false;
      input.click();
      return true;
    })()`);
    await cdp.waitForTruthy(
      `(() => {
        const confirmation = document.querySelector(
          '[data-testid=irrigation-application-confirmation] input',
        );
        const apply = document.querySelector('[data-testid=irrigation-apply]');
        return confirmation?.checked === true && apply?.disabled === false;
      })()`,
      "explicit irrigation target and timed-device safety confirmation",
    );
    await cdp.call("Network.setBlockedURLs", {
      urls: ["*/v1/farms/*/strategy-applications/*"],
    });
    await cdp.evaluate('document.querySelector("[data-testid=irrigation-apply]").click(); true');
    await cdp.waitForValue(
      'document.querySelector("[data-testid=irrigation-application-status] strong")?.textContent',
      "적용 중",
      "accepted pending irrigation application",
    );
    await cdp.waitForTruthy(
      `(() => {
        const section = document.querySelector('[data-testid=operations-irrigation]');
        const apply = document.querySelector('[data-testid=irrigation-apply]');
        const strategy = document.querySelector('[data-testid=irrigation-strategy-select]');
        const targets = Array.from(document.querySelectorAll(
          '[data-testid=irrigation-area-option] input',
        ));
        return section?.querySelector('.inline-error') !== null
          && apply?.disabled === true
          && apply?.textContent === '결과 확인 대기'
          && strategy?.disabled === true
          && targets.length === 2
          && targets.every((target) => target.disabled === true);
      })()`,
      "accepted irrigation application preserved after projection poll failure",
    );
    await cdp.call("Network.setBlockedURLs", { urls: [] });
    await cdp.evaluate(`(() => {
      document.querySelector('#operations-title')?.closest('.page-shell')
        ?.querySelector('.page-header .text-button')?.click();
      return true;
    })()`);
    await cdp.waitForValue(
      'document.querySelector("[data-testid=irrigation-application-status] strong")?.textContent',
      "적용 완료",
      "successful resumed irrigation strategy application",
      15_000,
    );
    await cdp.waitForValue(
      'document.querySelectorAll("[data-testid=irrigation-target-result]").length',
      1,
      "one irrigation target result",
    );
    assert.equal(
      await cdp.evaluate(`(() => {
        const result = document.querySelector('[data-testid=irrigation-target-result]');
        return result?.textContent?.includes('재배 베드 2') === true
          && result?.textContent?.includes('제어 완료') === true
          && result?.textContent?.includes('5초 설정 · 최종 off 확인') === true
          && result?.textContent?.includes('정지') === true;
      })()`),
      true,
    );
    assert.equal(
      await cdp.evaluate(`(() => {
        const confirmation = document.querySelector(
          '[data-testid=irrigation-application-confirmation] input',
        );
        const apply = document.querySelector('[data-testid=irrigation-apply]');
        return confirmation?.checked === false && apply?.disabled === true;
      })()`),
      true,
      "A completed application must require confirmation before any repeat",
    );

    await cdp.evaluate('document.querySelector("[data-testid=nav-alarms]").click(); true');
    await cdp.waitForValue(
      'document.querySelectorAll("[data-testid=audit-event]").length',
      3,
      "alarm plus irrigation command and strategy audits",
      12_000,
    );
    assert.equal(
      await cdp.evaluate(`(() => {
        const events = Array.from(document.querySelectorAll('[data-testid=audit-event]'));
        return events.filter((event) => event.textContent?.includes('전략 적용')).length === 1
          && events.filter((event) => event.textContent?.includes('명령 완료')).length === 1
          && events.filter((event) => event.textContent?.includes('알람 확인')).length === 1;
      })()`),
      true,
    );

    await cdp.evaluate('document.querySelector("[data-testid=nav-operations]").click(); true');
    await cdp.evaluate(`(() => {
      const previous = document.querySelector(
        '[data-testid=irrigation-area-option] input[value="area:bed-2"]',
      );
      const next = document.querySelector(
        '[data-testid=irrigation-area-option] input[value="area:bed-1"]',
      );
      if (!(previous instanceof HTMLInputElement) || !(next instanceof HTMLInputElement)) return false;
      if (previous.checked) previous.click();
      if (!next.checked) next.click();
      return true;
    })()`);
    await cdp.waitForTruthy(
      `(() => {
        const selected = document.querySelector(
          '[data-testid=irrigation-area-option] input[value="area:bed-1"]',
        );
        const other = document.querySelector(
          '[data-testid=irrigation-area-option] input[value="area:bed-2"]',
        );
        return selected?.checked === true && other?.checked === false;
      })()`,
      "second timed irrigation target for manual stop",
    );
    await cdp.evaluate(`(() => {
      const confirmation = document.querySelector(
        '[data-testid=irrigation-application-confirmation] input',
      );
      if (!(confirmation instanceof HTMLInputElement)) return false;
      if (!confirmation.checked) confirmation.click();
      return true;
    })()`);
    await cdp.waitForTruthy(
      'document.querySelector("[data-testid=irrigation-apply]")?.disabled === false',
      "second irrigation confirmation",
    );
    await cdp.evaluate('document.querySelector("[data-testid=irrigation-apply]").click(); true');
    await cdp.waitForValue(
      'document.querySelector("[data-testid=irrigation-application-status] strong")?.textContent',
      "적용 중",
      "second timed irrigation accepted before manual stop",
    );
    await delay(500);

    await cdp.evaluate('document.querySelector("[data-testid=nav-control]").click(); true');
    await cdp.waitForValue(
      'document.querySelectorAll("[data-testid^=control-profile-card-]").length',
      2,
      "default farm control profile",
    );
    await cdp.waitForTruthy(
      'document.querySelector("[data-testid=edit-control-profile]")?.disabled === false',
      "enabled farm control profile edit action",
    );
    await cdp.evaluate('document.querySelector("[data-testid=edit-control-profile]")?.click(); true');
    await cdp.waitForTruthy(
      'document.querySelector("[data-testid=control-profile-editor]") !== null',
      "farm control profile editor",
    );
    const personalizedControlLabel = "육묘동 맞춤 급수";
    await setFormControlValue(
      cdp,
      '[data-testid="control-profile-label-device:bed-1"]',
      personalizedControlLabel,
    );
    await cdp.waitForTruthy(
      'document.querySelector("[data-testid=control-profile-editor]") !== null',
      "farm control profile editor after label update",
    );
    await cdp.evaluate(`(() => {
      const start = document.querySelector('[data-testid="control-profile-start-device:bed-1"]');
      if (!(start instanceof HTMLInputElement)) return false;
      if (start.checked) start.click();
      return true;
    })()`);
    await cdp.waitForTruthy(
      'document.querySelector("[data-testid=control-profile-editor]") !== null',
      "farm control profile editor after start visibility update",
    );
    await delay(100);
    const controlProfileSaveState = await cdp.evaluate(`(() => {
      const save = document.querySelector('[data-testid=save-control-profile]');
      return {
        present: save !== null,
        disabled: save?.disabled ?? null,
        rows: Array.from(document.querySelectorAll('[data-testid^=control-profile-editor-device]')).map((row) => ({
          label: row.querySelector('input[type=text]')?.value ?? null,
          checked: row.querySelector('input[type=checkbox]')?.checked ?? null,
        })),
      };
    })()`);
    assert.equal(
      controlProfileSaveState.present && controlProfileSaveState.disabled === false,
      true,
      `Farm control profile save action was not enabled: ${JSON.stringify(controlProfileSaveState)}`,
    );
    await cdp.evaluate('document.querySelector("[data-testid=save-control-profile]")?.click(); true');
    await cdp.waitForTruthy(
      `document.querySelector("[data-testid=farm-control-profile]")?.textContent?.includes(${JSON.stringify(personalizedControlLabel)}) === true
        && document.querySelector("[data-testid=control-profile-revision]")?.textContent?.includes("1") === true
        && document.querySelector("[data-testid=farm-control-profile]")?.textContent?.includes("맞춤 제어 설정을 저장했습니다") === true`,
      "saved farm control personalization",
    );
    assert.equal(
      await cdp.evaluate(`(() => {
        const card = document.querySelector('[data-testid="control-profile-card-device:bed-1"]');
        return card?.textContent?.includes('소프트웨어 정지') === true
          && card?.querySelector('.primary-control') === null
          && document.querySelector('[data-testid=pump-on]') === null;
      })()`),
      true,
    );
    await cdp.waitForTruthy(
      `(() => {
        const stop = document.querySelector('[data-testid=pump-off]');
        const page = document.querySelector('#control-title')?.closest('.page-shell');
        return stop !== null
          && stop.disabled === false
          && stop.textContent?.includes('즉시 정지') === true
          && page?.textContent?.includes('물리 비상정지 버튼이나 안전 인터록을 대체하지 않습니다') === true;
      })()`,
      "available software stop with physical-safety boundary",
    );
    await cdp.evaluate('document.querySelector("[data-testid=pump-off]").click(); true');
    await cdp.waitForValue(
      'document.querySelector("[data-testid=command-status]")?.textContent',
      "제어 완료",
      "acknowledged software stop",
      5_000,
    );
    assert.equal(
      await cdp.evaluate('document.querySelector(".pump-state")?.textContent'),
      "정지",
    );

    await cdp.evaluate('document.querySelector("[data-testid=nav-operations]").click(); true');
    await cdp.waitForValue(
      'document.querySelector("[data-testid=irrigation-application-status] strong")?.textContent',
      "적용 실패",
      "manual-stop terminal irrigation result",
      5_000,
    );
    await cdp.waitForTruthy(
      `(() => {
        const result = document.querySelector('[data-testid=irrigation-target-result]');
        const rows = Array.from(document.querySelectorAll('[data-testid=operations-command-row]'));
        return result?.textContent?.includes('사용자 즉시 정지') === true
          && result?.textContent?.includes('사용자 정지로 조기 종료') === true
          && result?.textContent?.includes('연결된 정지 요청') === true
          && rows.some((row) => row.textContent?.includes('사용자 즉시 정지로 중단'));
      })()`,
      "causal manual-stop result and command history",
      5_000,
    );

    await cdp.waitForTruthy(
      'document.querySelector("[data-testid=nav-environment]") !== null',
      "page navigation",
    );
    await cdp.evaluate('document.querySelector("[data-testid=nav-environment]").click(); true');
    const environmentMetrics = [
      "temperature",
      "humidity",
      "illuminance",
      "water_level",
    ];
    for (const metric of environmentMetrics) {
      const selector = `[data-testid=environment-metric-${metric}]`;
      await cdp.waitForTruthy(
        `document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() !== "--"`,
        `environment-page live ${metric}`,
      );
    }
    await cdp.waitForTruthy(
      'document.querySelector("[data-testid=telemetry-history-temperature] .telemetry-chart") !== null',
      "environment telemetry history chart",
    );
    assert.equal(
      await cdp.evaluate('document.querySelectorAll("[data-testid^=telemetry-history-]").length'),
      environmentMetrics.length,
    );
    let liveEnvironmentValues = await readEnvironmentMetricValues(cdp, environmentMetrics);
    assert.equal(
      await cdp.evaluate('document.querySelector(".connection-state")?.textContent?.trim()'),
      "온라인",
    );

    assert.equal(
      await cdp.evaluate('navigator.serviceWorker.ready.then(() => true)'),
      true,
    );
    await reloadAndWaitForApp(cdp);
    assert.equal(await cdp.evaluate("navigator.serviceWorker.controller !== null"), true);

    await cdp.evaluate('document.querySelector("[data-testid=nav-control]").click(); true');
    await cdp.waitForValue(
      'document.querySelector("#pump-title")?.textContent',
      personalizedControlLabel,
      "persisted farm control personalization after reload",
    );
    assert.equal(
      await cdp.evaluate('document.querySelector("[data-testid=pump-on]") === null'),
      true,
      "hidden start action reappeared outside the personalized card after reload",
    );
    await cdp.evaluate('document.querySelector("[data-testid=edit-control-profile]")?.click(); true');
    await cdp.waitForTruthy(
      'document.querySelector("[data-testid=control-profile-editor]") !== null',
      "farm control profile editor after reload",
    );
    await cdp.evaluate(`(() => {
      const start = document.querySelector('[data-testid="control-profile-start-device:bed-1"]');
      if (!(start instanceof HTMLInputElement)) return false;
      if (!start.checked) start.click();
      return true;
    })()`);
    await cdp.waitForTruthy(
      'document.querySelector("[data-testid=save-control-profile]")?.disabled === false',
      "re-enabled personalized start action",
    );
    await cdp.evaluate('document.querySelector("[data-testid=save-control-profile]")?.click(); true');
    await cdp.waitForTruthy(
      `document.querySelector("[data-testid=control-profile-revision]")?.textContent?.includes("2") === true
        && document.querySelector("[data-testid=pump-on]") !== null`,
      "persisted re-enabled personalized start action",
    );
    await cdp.waitForTruthy(
      'document.querySelector("[data-testid=pump-on]") !== null',
      "control page",
    );
    await cdp.evaluate('document.querySelector("[data-testid=pump-on]").click(); true');
    await cdp.waitForValue(
      'document.querySelector("[data-testid=command-status]")?.textContent',
      "장치 응답 대기 중",
      "accepted pending pump command",
    );
    await cdp.call("Network.setBlockedURLs", {
      urls: ["*/v1/farms/*/commands/*"],
    });
    await cdp.waitForTruthy(
      `document.querySelector("[data-testid=command-status]")?.textContent === "장치 응답 대기 중"
        && document.querySelector("#control-title")?.closest(".page-shell")?.querySelector(".inline-error") !== null`,
      "accepted command preserved after projection poll failure",
    );
    await cdp.call("Network.setBlockedURLs", { urls: [] });
    await cdp.waitForValue(
      'document.querySelector("[data-testid=command-status]")?.textContent',
      "제어 완료",
      "acknowledged pump command",
      15_000,
    );
    assert.equal(
      await cdp.evaluate('document.querySelector(".pump-state")?.textContent'),
      "작동 중",
    );

    await reloadAndWaitForApp(cdp);
    await cdp.waitForValue(
      'document.querySelector("[data-testid=command-status]")?.textContent',
      "제어 완료",
      "rehydrated command projection",
    );
    assert.equal(
      await cdp.evaluate('document.querySelector(".pump-state")?.textContent'),
      "작동 중",
    );

    await cdp.evaluate('document.querySelector("[data-testid=nav-operations]").click(); true');
    await cdp.waitForTruthy(
      'document.querySelector("[data-testid=operations-command-history]") !== null',
      "operations command history",
    );
    await cdp.waitForValue(
      'document.querySelectorAll("[data-testid=operations-command-row]").length',
      4,
      "completed strategy, interrupted strategy, stop, and manual control results",
      12_000,
    );
    assert.equal(
      await cdp.evaluate(`(() => {
        const rows = Array.from(document.querySelectorAll("[data-testid=operations-command-row]"));
        return rows.filter((row) => row.textContent?.includes("제어 완료")).length === 3
          && rows.filter((row) => row.textContent?.includes("제어 실패")).length === 1
          && rows.some((row) => row.textContent?.includes("사용자 정지로 조기 종료"));
      })()`),
      true,
    );
    assert.equal(
      await cdp.evaluate(`(() => {
        const rows = Array.from(document.querySelectorAll("[data-testid=operations-command-row]"));
        return rows.some((row) => row.textContent?.includes("재배 베드 1"))
          && rows.some((row) => row.textContent?.includes("재배 베드 2"));
      })()`),
      true,
    );

    await cdp.evaluate('document.querySelector("[data-testid=nav-alarms]").click(); true');
    await cdp.waitForValue(
      'document.querySelectorAll("[data-testid=audit-event]").length',
      7,
      "alarm, strategy, and farm-wide manual control audits",
      12_000,
    );
    await cdp.waitForTruthy(
      `(() => {
        const events = Array.from(document.querySelectorAll("[data-testid=audit-event]"));
        return events.some((event) => event.textContent?.includes("농장 공통 제어")
          && event.textContent?.includes("수동 펌프 켜기")
          && event.textContent?.includes("최종 상태 작동 중"));
      })()`,
      "farm-wide manual control audit after direct ACK",
      12_000,
    );

    const createdCropName = "브라우저 검증 바질";
    const updatedCropName = "브라우저 검증 바질 수정";
    await cdp.evaluate('document.querySelector("[data-testid=nav-crops]").click(); true');
    await cdp.waitForTruthy(
      'document.querySelector("[data-testid=crop-create-form]") !== null',
      "crop management form",
    );
    await setFormControlValue(cdp, "[data-testid=crop-name-input]", createdCropName);
    await cdp.evaluate('document.querySelector("[data-testid=crop-create-submit]").click(); true');
    await cdp.waitForValue(
      'document.querySelector("[data-testid=crop-row-created] strong")?.textContent',
      createdCropName,
      "created crop row",
    );

    await reloadAndWaitForApp(cdp);
    await cdp.waitForTruthy(
      `Array.from(document.querySelectorAll(".crop-row strong")).some((element) => element.textContent === ${JSON.stringify(createdCropName)})`,
      "persisted crop after reload",
    );
    await cdp.evaluate(`(() => {
      const row = Array.from(document.querySelectorAll(".crop-row"))
        .find((element) => element.querySelector("strong")?.textContent === ${JSON.stringify(createdCropName)});
      row?.querySelector("[data-testid=crop-edit-action]")?.click();
      return row !== undefined;
    })()`);
    await cdp.waitForTruthy(
      'document.querySelector("[data-testid=crop-edit-submit]") !== null',
      "crop edit form",
    );
    await setFormControlValue(cdp, "[data-testid=crop-name-input]", updatedCropName);
    await cdp.evaluate('document.querySelector("[data-testid=crop-edit-submit]").click(); true');
    await cdp.waitForTruthy(
      `Array.from(document.querySelectorAll(".crop-row strong")).some((element) => element.textContent === ${JSON.stringify(updatedCropName)})`,
      "updated crop row",
    );

    await cdp.evaluate(`(() => {
      const row = Array.from(document.querySelectorAll(".crop-row"))
        .find((element) => element.querySelector("strong")?.textContent === ${JSON.stringify(updatedCropName)});
      row?.querySelector("[data-testid=crop-delete-action]")?.click();
      return row !== undefined;
    })()`);
    await cdp.waitForTruthy(
      'document.querySelector("[data-testid=crop-delete-confirm]") !== null',
      "crop delete confirmation",
    );
    await cdp.evaluate('document.querySelector("[data-testid=crop-delete-confirm]").click(); true');
    await cdp.waitForTruthy(
      `!Array.from(document.querySelectorAll(".crop-row strong")).some((element) => element.textContent === ${JSON.stringify(updatedCropName)})`,
      "deleted crop row",
    );

    await cdp.evaluate('document.querySelector("[data-testid=nav-weather]").click(); true');
    await cdp.waitForValue(
      'document.querySelector("#weather-title")?.textContent',
      "농장 외부 날씨",
      "weather and location page",
    );
    assert.equal(
      await cdp.evaluate('document.querySelectorAll(".status-chip").length'),
      2,
    );
    await cdp.waitForTruthy(
      'document.querySelector("[data-testid=weather-temperature]")?.textContent?.trim() !== "--"',
      "normalized fixture weather",
    );
    assert.equal(
      await cdp.evaluate('document.querySelector("[data-testid=weather-source-kind]")?.textContent'),
      "시범 데이터",
    );
    assert.equal(
      await cdp.evaluate('document.querySelector("[data-testid=weather-fixture-notice]") !== null'),
      true,
    );
    assert.equal(
      await cdp.evaluate('document.querySelector(".temperature-number") === null'),
      true,
    );

    await cdp.evaluate('document.querySelector("[data-testid=nav-environment]").click(); true');
    for (const metric of environmentMetrics) {
      const selector = `[data-testid=environment-metric-${metric}]`;
      await cdp.waitForTruthy(
        `document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() !== "--"`,
        `environment ${metric} after page navigation`,
      );
    }
    liveEnvironmentValues = await readEnvironmentMetricValues(cdp, environmentMetrics);

    await cdp.call("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    assert.equal(
      await cdp.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"),
      true,
    );

    await cdp.call("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
      connectionType: "none",
    });
    await cdp.call("Network.overrideNetworkState", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
      connectionType: "none",
    });
    await cdp.evaluate('document.querySelector("[data-testid=nav-operations]").click(); true');
    await cdp.waitForValue(
      'document.querySelector(".connection-state")?.textContent?.trim()',
      "오프라인",
      "offline API connection state before operations check",
    );
    await cdp.waitForTruthy(
      `(() => {
        const button = document.querySelector("#operations-title")?.closest(".page-shell")
          ?.querySelector(".page-header .text-button");
        return button !== null && !button.disabled;
      })()`,
      "available operations refresh while offline",
    );
    await cdp.evaluate(`(() => {
      document.querySelector("#operations-title")?.closest(".page-shell")
        ?.querySelector(".page-header .text-button")?.click();
      return true;
    })()`);
    await cdp.waitForTruthy(
      'document.querySelector("#operations-cycle-title")?.closest(".panel-block")?.querySelector(".inline-error") !== null',
      "operations refresh error while retaining the selected cycle",
    );
    assert.equal(
      await cdp.evaluate('document.querySelector("[data-testid=operations-cycle-select]") !== null'),
      true,
    );
    assert.equal(
      await cdp.evaluate('document.querySelectorAll("[data-testid=operations-area-card]").length'),
      2,
    );
    await cdp.waitForValue(
      'document.querySelectorAll("[data-testid=operations-comparison-area]").length',
      2,
      "preserved two-area comparison while offline",
    );
    assert.equal(
      await cdp.evaluate(`Array.from(document.querySelectorAll("[data-testid^=operations-comparison-freshness-]"))
        .every((element) => element.textContent?.includes("오프라인"))`),
      true,
    );
    assert.equal(
      await cdp.evaluate(`Array.from(document.querySelectorAll("[data-testid=operations-comparison-value]"))
        .every((element) => element.textContent?.trim() !== "--")`),
      true,
    );
    assert.equal(
      await cdp.evaluate('document.querySelectorAll("[data-testid=operations-command-row]").length'),
      4,
      "Recent command history should remain visible during a same-session outage",
    );
    await cdp.evaluate('document.querySelector("[data-testid=nav-alarms]").click(); true');
    await cdp.waitForValue(
      'document.querySelectorAll("[data-testid=alarm-cleared-card]").length',
      1,
      "preserved cleared alarm during outage",
    );
    await cdp.waitForValue(
      'document.querySelectorAll("[data-testid=audit-event]").length',
      7,
      "preserved alarm, irrigation, and farm-wide manual control audit events during outage",
    );
    await cdp.waitForTruthy(
      'document.querySelector("#audit-events-title")?.closest(".panel-block")?.querySelector(".inline-error") !== null',
      "audit refresh error while retaining history",
      12_000,
    );
    await cdp.evaluate('document.querySelector("[data-testid=nav-environment]").click(); true');
    liveEnvironmentValues = await readEnvironmentMetricValues(cdp, environmentMetrics);
    await reloadAndWaitForApp(cdp);
    await cdp.waitForValue(
      'document.querySelector(".cached-label")?.textContent',
      "저장된 값",
      "offline cached telemetry",
    );
    assert.deepEqual(
      await readEnvironmentMetricValues(cdp, environmentMetrics),
      liveEnvironmentValues,
      "Offline environment telemetry did not match the last live readings",
    );
    assert.equal(
      await cdp.evaluate('document.querySelectorAll(".cached-label").length'),
      environmentMetrics.length,
      "Every environment metric should be marked as cached while offline",
    );
    await cdp.waitForValue(
      'document.querySelector(".connection-state")?.textContent?.trim()',
      "오프라인",
      "offline API connection state",
    );
    await cdp.evaluate('document.querySelector("[data-testid=nav-control]").click(); true');
    await cdp.waitForValue(
      'document.querySelector("[data-testid=command-status]")?.textContent',
      "제어 완료",
      "offline cached command state on control page",
    );
    assert.equal(
      await cdp.evaluate(`document.querySelector("[data-testid=pump-on]") === null
        && document.querySelector("[data-testid=pump-off]")?.disabled === true`),
      true,
      "Offline control must fail closed when the personalized profile cannot be refreshed",
    );
    await cdp.call("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
      connectionType: "wifi",
    });

    await cdp.call("Page.navigate", { url: `${pwaUrl}#settings` });
    await cdp.waitForTruthy(
      'document.querySelector(".settings-page") !== null',
      "settings page",
      15_000,
    );
    assert.equal(
      await cdp.evaluate(`document.querySelector(".admin-console-link")?.href === ${JSON.stringify(adminUrl)}`),
      true,
      "PWA settings must link to the separate admin console",
    );
    assert.equal(
      await cdp.evaluate('document.querySelector("input[type=password]") === null'),
      true,
      "PWA settings must not collect OS or Edge passwords",
    );

    await cdp.call("Page.navigate", { url: adminUrl });
    await cdp.waitForTruthy(
      'document.querySelector(".admin-shell") !== null && document.querySelectorAll(".selector-grid option").length >= 2',
      "admin gateway console",
      15_000,
    );
    await cdp.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll("button"))
        .find((element) => element.textContent?.includes("10분 연결 코드 발급"));
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })()`);
    await cdp.waitForTruthy(
      'document.querySelector("output.token-output")?.textContent?.trim().length > 40',
      "one-time enrollment token result",
      15_000,
    );
    assert.equal(await cdp.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll("button"))
        .find((element) => element.textContent?.includes("연결 코드 취소"));
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })()`), true, "Admin must expose an enabled enrollment cancellation action");
    await cdp.waitForTruthy(
      `(() => {
        const status = document.querySelector(".record-list strong")?.textContent?.trim();
        const secret = document.querySelector("output.token-output");
        return status === "취소됨" && secret === null;
      })()`,
      "cancelled enrollment token state",
      15_000,
    );
    assert.equal(
      await cdp.evaluate('document.querySelector("input[type=password]") === null'),
      true,
      "Admin console must not collect Pi-local OS passwords",
    );
    assert.equal(
      await cdp.evaluate(`Object.keys(localStorage).every((key) => {
        const value = localStorage.getItem(key) ?? "";
        return !value.includes("gateway-enrollment:") && !value.includes("edge-credential:");
      })`),
      true,
      "One-time enrollment secrets must not be persisted in browser storage",
    );
    await cdp.call("Network.overrideNetworkState", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
      connectionType: "wifi",
    });

    cdp.close();
    cdp = null;
    await terminateChild(chrome, "SIGTERM");
    chrome = null;
    const launcherExitedGracefully = await terminateChild(launcher, "SIGINT");
    launcher = null;
    assert.equal(
      launcherExitedGracefully,
      true,
      "Local demo launcher required a forced kill after SIGINT",
    );

    process.stdout.write(
      "PWA browser two-area telemetry/history comparison and freshness, low-water alarm trigger/acknowledgement/clear/audit, five-second device-local timed irrigation pending/final-off/ACK aggregation/audit, device-local software stop interruption/causal history, farm control personalization/save/reload, recent control history, page separation, multi-metric environment telemetry/cache, control acknowledgement, crop CRUD/reload, weather/location fixture slice, mobile layout, offline preservation, offline shell, separate admin navigation, one-time gateway enrollment issue/cancel, browser secret non-persistence, and launcher shutdown paths passed.\n",
    );
  } catch (error) {
    const detail = launcherOutput.trim() === "" ? "" : `\nLauncher output:\n${launcherOutput}`;
    const diagnostic = error instanceof Error ? (error.stack ?? error.message) : String(error);
    throw new Error(`${diagnostic}${detail}`);
  } finally {
    cdp?.close();
    await terminateChild(chrome, "SIGTERM");
    await terminateChild(launcher, "SIGINT");
    await rm(directory, { recursive: true, force: true });
  }
}

async function readEnvironmentMetricValues(cdp, metrics) {
  return cdp.evaluate(`Object.fromEntries(${JSON.stringify(metrics)}.map((metric) => {
    const value = document.querySelector(\`[data-testid=environment-metric-\${metric}]\`)
      ?.textContent
      ?.trim();
    return [metric, value ?? null];
  }))`);
}

async function setFormControlValue(cdp, selector, value) {
  const result = await cdp.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLInputElement)) return null;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter === undefined) return null;
    setter.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event("input", { bubbles: true }));
    return element.value;
  })()`);
  assert.equal(result, value, `Could not set ${selector}`);
}

async function reloadAndWaitForApp(cdp) {
  await cdp.call("Page.reload", { ignoreCache: false });
  await delay(350);
  await cdp.waitForTruthy(
    'document.readyState === "complete" && document.querySelector(".app-shell") !== null && document.querySelector("[data-testid=nav-crops]") !== null',
    "rendered app shell",
    15_000,
  );
}

async function createCdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id === undefined) return;
    const operation = pending.get(message.id);
    if (operation === undefined) return;
    pending.delete(message.id);
    if (message.error !== undefined) operation.reject(new Error(message.error.message));
    else operation.resolve(message.result);
  });

  const call = (method, params = {}) => {
    const id = ++nextId;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  };
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails !== undefined) {
      throw new Error(
        result.exceptionDetails.exception?.description
          ?? result.exceptionDetails.text
          ?? "Browser evaluation failed",
      );
    }
    return result.result.value;
  };
  const waitForValue = async (expression, expected, label, timeoutMs = 8_000) => {
    const deadline = Date.now() + timeoutMs;
    let value;
    while (Date.now() < deadline) {
      value = await evaluate(expression);
      if (value === expected) return value;
      await delay(100);
    }
    throw new Error(`Timed out waiting for ${label}; last value was ${String(value)}`);
  };
  const waitForTruthy = async (expression, label, timeoutMs = 8_000) => {
    const deadline = Date.now() + timeoutMs;
    let value;
    while (Date.now() < deadline) {
      value = await evaluate(expression);
      if (value) return value;
      await delay(100);
    }
    throw new Error(`Timed out waiting for ${label}; last value was ${String(value)}`);
  };

  return {
    call,
    evaluate,
    waitForValue,
    waitForTruthy,
    close: () => socket.close(),
  };
}

async function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((value) => value !== undefined && value.trim() !== "");

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next known executable location.
    }
  }
  return null;
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  await new Promise((resolve, reject) => server.close((error) => (
    error === undefined ? resolve() : reject(error)
  )));
  return address.port;
}

async function waitForHttp(url, launcher, readOutput) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (launcher.exitCode !== null || launcher.signalCode !== null) {
      throw new Error(`Local demo launcher exited before PWA startup\n${readOutput()}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The two child processes may still be starting.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for local PWA startup\n${readOutput()}`);
}

async function waitForDevToolsPort(profilePath, chrome) {
  const file = join(profilePath, "DevToolsActivePort");
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (chrome.exitCode !== null || chrome.signalCode !== null) {
      throw new Error("Chrome exited before opening its debugging port");
    }
    try {
      const [port] = (await readFile(file, "utf8")).trim().split("\n");
      const parsed = Number.parseInt(port ?? "", 10);
      if (Number.isInteger(parsed) && parsed > 0) return parsed;
    } catch {
      // Chrome has not written the port file yet.
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for Chrome debugging port");
}

async function waitForPageTarget(port, pageUrl, chrome) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (chrome.exitCode !== null || chrome.signalCode !== null) {
      throw new Error("Chrome exited before creating the PWA page");
    }
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const page = targets.find((target) => target.type === "page" && target.url === pageUrl);
      if (page?.webSocketDebuggerUrl !== undefined) return page;
    } catch {
      // The DevTools HTTP endpoint may still be starting.
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for the SmartFarm PWA page target");
}

async function terminateChild(child, signal) {
  if (child === null) return true;
  if (child.exitCode !== null || child.signalCode !== null) return false;
  const exit = once(child, "exit");
  child.kill(signal);
  const exited = await Promise.race([
    exit.then(() => true),
    delay(5_000).then(() => false),
  ]);
  if (!exited) {
    child.kill("SIGKILL");
    await exit;
  }
  return exited;
}

function appendBounded(current, chunk) {
  return `${current}${String(chunk)}`.slice(-8_000);
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
