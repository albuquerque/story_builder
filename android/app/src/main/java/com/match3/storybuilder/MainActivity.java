package com.match3.storybuilder;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Some Android GPUs (e.g. Adreno) fail to paint the WebView's first
        // frame, leaving a white screen until a repaint happens. Nudge the
        // WebView to invalidate/redraw shortly after load. The web layer also
        // forces repaints (see boot.js), so this is a belt-and-suspenders.
        final WebView wv = getBridge() != null ? getBridge().getWebView() : null;
        if (wv != null) {
            wv.postDelayed(new Runnable() {
                @Override public void run() {
                    wv.invalidate();
                    wv.requestLayout();
                }
            }, 300);
            wv.postDelayed(new Runnable() {
                @Override public void run() { wv.invalidate(); }
            }, 800);
        }
    }
}
