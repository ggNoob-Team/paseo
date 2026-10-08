import web_webview from "@ohos.web.webview";
import common from "@ohos.app.ability.common";
import resourceManager from "@ohos.resourceManager";
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

  build() {
    Column() {
      Web({ src: ENTRY_URL, controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        // IndexedDB backs the replica row store on web (row-store.web.ts).
        .databaseAccess(true)
        .mediaPlayGestureAccess(true)
        .mixedMode(MixedMode.All)
        .onInterceptRequest((event) => {
          return this.serveRawFile(event);
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
