package com.hyperdo.app;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Share target ("Share → Hyper Do"): ACTION_SEND text/plain intents are turned into a window event
 * `hyperdoShare` with { "text", "subject" } for the web app (src/lib/platform.capacitor.ts).
 * On a cold start the page is not loaded yet, so the payload waits until the WebView reports the page
 * as loaded (and is retried from onResume); the JS side ignores an identical payload arriving twice.
 */
public class MainActivity extends BridgeActivity {

    private static final String SHARE_EVENT = "hyperdoShare";

    private String pendingShare;
    private boolean pageLoaded;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Bridge bridge = getBridge();
        if (bridge != null) {
            bridge.addWebViewListener(new WebViewListener() {
                @Override
                public void onPageLoaded(WebView webView) {
                    pageLoaded = true;
                    flushShare();
                }
            });
        }
        // A recreated activity (savedInstanceState != null) already delivered its launch intent.
        if (savedInstanceState == null) {
            handleShareIntent(getIntent());
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleShareIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        flushShare();
    }

    private void handleShareIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) {
            return;
        }
        String type = intent.getType();
        if (type == null || !type.startsWith("text/")) {
            return;
        }
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        if ((text == null || text.trim().isEmpty()) && (subject == null || subject.trim().isEmpty())) {
            return;
        }
        JSONObject json = new JSONObject();
        try {
            json.put("text", text == null ? "" : text);
            if (subject != null && !subject.trim().isEmpty()) {
                json.put("subject", subject);
            }
        } catch (JSONException e) {
            return;
        }
        pendingShare = json.toString();
        flushShare();
    }

    /** Delivers the pending payload once the bridge exists and the page has loaded (posted on the WebView thread). */
    private void flushShare() {
        if (pendingShare == null || !pageLoaded) {
            return;
        }
        final Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) {
            return;
        }
        final String payload = pendingShare;
        pendingShare = null;
        bridge.getWebView().post(() -> bridge.triggerWindowJSEvent(SHARE_EVENT, payload));
    }
}
