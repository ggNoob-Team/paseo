import web_webview from "@ohos.web.webview";
import common from "@ohos.app.ability.common";
import pasteboard from "@ohos.pasteboard";
import resourceManager from "@ohos.resourceManager";
import type { BusinessError } from "@ohos.base";
import hilog from "@ohos.hilog";
import {
  ENTRY_PATH,
  ENTRY_URL,
  mimeTypeFor,
  rawFilePathForUrl,
  readRawFile,
} from "../web/rawfile-assets";

const LOG_DOMAIN: number = 0x0000;
const LOG_TAG: string = "PaseoHarmony";

/**
 * The system clipboard, for the web app.
 *
 * ArkWeb's own clipboard API asks the app for a read permission it never
 * receives, so text the user had just copied read back empty and the notes
 * capture told them to copy first. The pasteboard is the same clipboard with no
 * such gate, and it is what the injected `window.paseoClipboard` exposes.
 */
class ClipboardBridge {
  /**
   * ArkWeb does not hand a proxy method's return value back to the page, so the
   * result travels through the callback the page passes in. Both methods are
   * registered in asyncMethodList for the same reason.
   */
  readText(callback: (text: string) => void): void {
    try {
      const board = pasteboard.getSystemPasteboard();
      const value: string | undefined = board.hasDataSync()
        ? board.getDataSync().getPrimaryText()
        : "";
      callback(typeof value === "string" ? value : "");
    } catch (error) {
      hilog.warn(LOG_DOMAIN, LOG_TAG, "[clip-read] failed: %{public}s", `${error}`);
      callback("");
    }
  }

  writeText(text: string, callback: (copied: boolean) => void): void {
    try {
      const data = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text);
      pasteboard.getSystemPasteboard().setDataSync(data);
      callback(true);
    } catch (error) {
      hilog.warn(LOG_DOMAIN, LOG_TAG, "clipboard write failed: %{public}s", `${error}`);
      callback(false);
    }
  }
}

/**
 * Paseo HarmonyOS shell.
 *
 * Loads the Expo web build of packages/app from rawfile over the paseo://app
 * scheme and lets the web app do everything else: connections, pairing links,
 * terminal, files. There is no app logic here on purpose. See docs/harmonyos.md.
 */
@Entry
@Component
struct Index {
  private controller: web_webview.WebviewController = new web_webview.WebviewController();
  private resources: resourceManager.ResourceManager | null = null;
  /**
   * A unique document URL per launch. The bundle and its document are served from
   * this hap, but ArkWeb's cache and its restored page both kept handing back the
   * bundle of an earlier install after an update; a query string the cache has
   * never seen forces the document to be fetched and re-parsed every start.
   */
  private entryUrl: string = `${ENTRY_URL}?launch=${Date.now()}`;

  aboutToAppear(): void {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.resources = context.resourceManager;
  }

  /**
   * Serves paseo://app/* from rawfile. Extension-less misses fall back to
   * index.html so Expo Router deep links survive a reload.
   */
  private serveRawFile(event: OnInterceptRequestEvent): WebResourceResponse | null {
    const resources = this.resources;
    if (resources === null) {
      return null;
    }
    const requested = rawFilePathForUrl(event.request.getRequestUrl());
    if (requested === null) {
      return null;
    }
    let path = requested;
    let body = readRawFile(resources, path);
    if (body === null && path.indexOf(".") < 0) {
      path = ENTRY_PATH;
      body = readRawFile(resources, path);
    }
    const response = new WebResourceResponse();
    if (body === null) {
      hilog.warn(LOG_DOMAIN, LOG_TAG, "rawfile not found: %{public}s", requested);
      response.setResponseCode(404);
      response.setReasonMessage("Not Found");
      response.setResponseMimeType("text/plain");
      response.setResponseData("not found");
      return response;
    }
    response.setResponseCode(200);
    response.setReasonMessage("OK");
    response.setResponseMimeType(mimeTypeFor(path));
    response.setResponseHeader([{ headerKey: "Cache-Control", headerValue: "no-cache" }]);
    response.setResponseData(body);
    return response;
  }

  /**
   * Logs the web-platform facts that decide whether the shell works. Without a
   * debugger this is the only way to read them on device; DevEco Studio shows
   * hilog in its Log panel. See docs/harmonyos.md.
   */
  private logWebPlatformDiagnostics(): void {
    const script = `JSON.stringify({
      secure: window.isSecureContext,
      idb: typeof indexedDB !== "undefined",
      origin: location.origin,
      ua: navigator.userAgent,
      clip: typeof window.paseoClipboard?.writeText,
    })`;
    this.controller.runJavaScript(script, (error: BusinessError, result: string) => {
      if (error) {
        hilog.warn(LOG_DOMAIN, LOG_TAG, "diagnostics failed: %{public}s", `${error.message}`);
        return;
      }
      hilog.info(LOG_DOMAIN, LOG_TAG, "[paseo] %{public}s", result);
    });
  }

  /**
   * Hands a URL to whatever browser the device has. The shell owns one Web
   * component and draws no browser chrome, so nothing on a web page can be
   * closed, bookmarked, or copied from here — a link belongs to the system
   * browser, not to the app.
   */
  private openInSystemBrowser(url: string): void {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    context
      .startAbility({
        action: "ohos.want.action.viewData",
        entities: ["entity.system.browsable"],
        uri: url,
      })
      .catch((error: BusinessError) => {
        hilog.warn(LOG_DOMAIN, LOG_TAG, "opening %{public}s failed: %{public}s", url, error.message);
      });
  }

  build() {
    Column() {
      Web({ src: this.entryUrl, controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        // The app is served from this hap's rawfile, so the HTTP cache can only
        // ever hand back the bundle of a previous install: an updated hap kept
        // running its old JavaScript after an install until this was disabled.
        .cacheMode(CacheMode.None)
        // Copy buttons in the web app write here instead of through ArkWeb's
        // gated clipboard API. See ClipboardBridge.
        .javaScriptProxy({
          object: new ClipboardBridge(),
          name: "paseoClipboard",
          // Async-only registration: a method listed in methodList is treated as
          // synchronous and never receives the page's callback.
          methodList: [],
          asyncMethodList: ["readText", "writeText"],
          controller: this.controller,
        })
        // IndexedDB backs the replica row store on web (row-store.web.ts).
        .databaseAccess(true)
        .mediaPlayGestureAccess(true)
        .mixedMode(MixedMode.All)
        .onInterceptRequest((event) => {
          return this.serveRawFile(event);
        })
        .onPageEnd(() => {
          this.logWebPlatformDiagnostics();
        })
        // The web app records audio with getUserMedia; ArkWeb routes those
        // requests through here.
        .onPermissionRequest((event) => {
          if (!event) {
            return;
          }
          event.request.grant(event.request.getAccessibleResource());
        })
        // Returning false hands the selection back to ArkWeb's built-in picker.
        .onShowFileSelector(() => {
          return false;
        })
        .onDownloadStart((event) => {
          if (event) {
            hilog.info(LOG_DOMAIN, LOG_TAG, "download requested: %{public}s", event.url);
          }
        })
        // Links in the web app open with window.open. With no second Web
        // component to put them in, each request goes to the system browser and
        // ArkWeb is told no window was created: the app stays on its own page,
        // so Back keeps walking the app's history instead of reloading it.
        .multiWindowAccess(true)
        .onWindowNew((event) => {
          this.openInSystemBrowser(event.targetUrl);
          // No second Web component exists, so the request is answered with
          // "no window": the callback contract wants a controller here, and
          // null is the documented way to say the app did not create one.
          event.handler.setWebController(null);
        })
        // A link that still tries to navigate this component to a website (an
        // anchor the web app did not intercept) leaves the app the same way, so
        // the shell can never be stranded on a page with no way back.
        .onLoadIntercept((event) => {
          const url = event?.data.getRequestUrl();
          if (url === undefined || !event?.data.isMainFrame() || !/^https?:/i.test(url)) {
            return false;
          }
          this.openInSystemBrowser(url);
          return true;
        })
        // Surface the web app's console in hilog; it is the only debugging
        // channel we have on device.
        .onConsole((event) => {
          if (event) {
            hilog.info(LOG_DOMAIN, LOG_TAG, "%{public}s", event.message.getMessage());
          }
          return false;
        })
        .width("100%")
        .height("100%")
    }
    .width("100%")
    .height("100%")
  }

  onBackPress(): boolean {
    // accessBackward/backward throw BusinessError when the controller is not
    // attached yet; fall through to the default back behaviour in that case.
    try {
      if (this.controller.accessBackward()) {
        this.controller.backward();
        return true;
      }
    } catch (error) {
      hilog.warn(LOG_DOMAIN, LOG_TAG, "webview back failed: %{public}s", `${error}`);
    }
    return false;
  }
}
