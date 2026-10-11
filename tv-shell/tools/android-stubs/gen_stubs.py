#!/usr/bin/env python3
"""Generates minimal Android/NanoHTTPD API stubs so the app sources can be
type-checked with plain javac in an environment without the Android SDK.
Signatures mirror the public Android API; this is a local sanity check, not a
substitute for the real build."""
import os, re, sys, glob

OUT = sys.argv[1] if len(sys.argv) > 1 else "stubs"
RES = sys.argv[2] if len(sys.argv) > 2 else "../../android/app/src/main/res"

def w(path, body):
    full = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w") as f:
        f.write(body)

# ----------------------------------------------------------------- android
w("android/annotation/SuppressLint.java", "package android.annotation; public @interface SuppressLint { String[] value(); }")
w("android/util/Log.java", """package android.util; public final class Log {
 public static int i(String t,String m){return 0;} public static int w(String t,String m){return 0;} public static int e(String t,String m){return 0;}
 public static int e(String t,String m,Throwable x){return 0;} public static int d(String t,String m){return 0;} }""")
w("android/os/Bundle.java", "package android.os; public class Bundle {}")
w("android/os/SystemClock.java", "package android.os; public final class SystemClock { public static long uptimeMillis(){return 0;} }")
w("android/os/Build.java", """package android.os; public class Build { public static final String MODEL="";
 public static class VERSION { public static final int SDK_INT=0; public static final String RELEASE=""; }
 public static class VERSION_CODES { public static final int O=26; } }""")
w("android/graphics/Color.java", "package android.graphics; public class Color { public static final int BLACK=0; }")
w("android/net/Uri.java", "package android.net; public class Uri { public static Uri parse(String s){return null;} }")
w("android/content/Context.java", """package android.content; public class Context {
 public static final int MODE_PRIVATE=0; public static final String INPUT_METHOD_SERVICE="input_method";
 public Context getApplicationContext(){return this;} public SharedPreferences getSharedPreferences(String n,int m){return null;}
 public android.content.res.AssetManager getAssets(){return null;} public android.content.pm.PackageManager getPackageManager(){return null;}
 public String getPackageName(){return "";} public void startActivity(Intent i){} public String getString(int r){return "";}
 public String getString(int r,Object... a){return "";} public Object getSystemService(String n){return null;}
 public android.content.pm.ApplicationInfo getApplicationInfo(){return null;} }""")
w("android/content/SharedPreferences.java", """package android.content; public interface SharedPreferences {
 int getInt(String k,int d); boolean getBoolean(String k,boolean d); String getString(String k,String d); Editor edit();
 interface Editor { Editor putInt(String k,int v); Editor putBoolean(String k,boolean v); Editor putString(String k,String v); void apply(); } }""")
w("android/content/Intent.java", """package android.content; public class Intent { public static final String ACTION_VIEW="android.intent.action.VIEW";
 public static final String EXTRA_TITLE="android.intent.extra.TITLE"; public static final int FLAG_ACTIVITY_NEW_TASK=0x10000000;
 public Intent(String a){} public Intent(String a,android.net.Uri u){} public Intent(Context c,Class<?> k){}
 public Intent setDataAndType(android.net.Uri u,String t){return this;} public Intent putExtra(String k,String v){return this;}
 public Intent addFlags(int f){return this;} public Intent setPackage(String p){return this;} }""")
w("android/content/ActivityNotFoundException.java", "package android.content; public class ActivityNotFoundException extends RuntimeException {}")
w("android/content/DialogInterface.java", """package android.content; public interface DialogInterface {
 interface OnClickListener { void onClick(DialogInterface d,int which); } interface OnDismissListener { void onDismiss(DialogInterface d); } }""")
w("android/content/res/AssetManager.java", """package android.content.res; public class AssetManager { public static final int ACCESS_STREAMING=2;
 public java.io.InputStream open(String n,int mode) throws java.io.IOException {return null;} }""")
w("android/content/pm/PackageManager.java", """package android.content.pm; public class PackageManager {
 public static class NameNotFoundException extends Exception {}
 public java.util.List<ResolveInfo> queryIntentActivities(android.content.Intent i,int f){return null;}
 public PackageInfo getPackageInfo(String p,int f) throws NameNotFoundException {return null;} }""")
w("android/content/pm/ResolveInfo.java", "package android.content.pm; public class ResolveInfo { public ActivityInfo activityInfo; public CharSequence loadLabel(PackageManager pm){return null;} }")
w("android/content/pm/ActivityInfo.java", "package android.content.pm; public class ActivityInfo { public String packageName; }")
w("android/content/pm/PackageInfo.java", "package android.content.pm; public class PackageInfo { public String packageName; public String versionName; }")
w("android/content/pm/ApplicationInfo.java", "package android.content.pm; public class ApplicationInfo { public static final int FLAG_DEBUGGABLE=2; public int flags; }")
w("android/app/Application.java", "package android.app; public class Application extends android.content.Context { public void onCreate(){} }")
w("android/app/Activity.java", """package android.app; public class Activity extends android.content.Context {
 protected void onCreate(android.os.Bundle b){} protected void onResume(){} protected void onPause(){} protected void onDestroy(){}
 public void setContentView(int id){} public <T extends android.view.View> T findViewById(int id){return null;}
 public android.view.Window getWindow(){return null;} public Application getApplication(){return null;}
 public void runOnUiThread(Runnable r){} public void finishAffinity(){} public void finish(){}
 public boolean dispatchKeyEvent(android.view.KeyEvent e){return false;} }""")
w("android/app/AlertDialog.java", """package android.app; public class AlertDialog implements android.content.DialogInterface {
 public static class Builder { public Builder(android.content.Context c){}
  public Builder setTitle(int r){return this;} public Builder setMessage(CharSequence m){return this;} public Builder setMessage(int r){return this;}
  public Builder setPositiveButton(int r,android.content.DialogInterface.OnClickListener l){return this;}
  public Builder setNegativeButton(int r,android.content.DialogInterface.OnClickListener l){return this;}
  public Builder setOnDismissListener(android.content.DialogInterface.OnDismissListener l){return this;} public AlertDialog show(){return null;} } }""")
w("android/view/Window.java", "package android.view; public class Window { public void addFlags(int f){} public View getDecorView(){return null;} }")
w("android/view/WindowManager.java", "package android.view; public interface WindowManager { class LayoutParams { public static final int FLAG_KEEP_SCREEN_ON=128; } }")
w("android/view/KeyEvent.java", """package android.view; public class KeyEvent { public static final int ACTION_DOWN=0, ACTION_UP=1;
 public static final int KEYCODE_BACK=4, KEYCODE_MENU=82, KEYCODE_MEDIA_PLAY_PAUSE=85, KEYCODE_HEADSETHOOK=79, KEYCODE_MEDIA_PLAY=126,
  KEYCODE_MEDIA_PAUSE=127, KEYCODE_MEDIA_STOP=86, KEYCODE_MEDIA_REWIND=89, KEYCODE_MEDIA_FAST_FORWARD=90;
 public int getKeyCode(){return 0;} public int getAction(){return 0;} public int getRepeatCount(){return 0;} }""")
w("android/view/View.java", """package android.view; public class View { public static final int VISIBLE=0, GONE=8, FOCUS_DOWN=130;
 public static final int SYSTEM_UI_FLAG_LAYOUT_STABLE=256, SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION=512, SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN=1024,
  SYSTEM_UI_FLAG_HIDE_NAVIGATION=2, SYSTEM_UI_FLAG_FULLSCREEN=4, SYSTEM_UI_FLAG_IMMERSIVE_STICKY=4096;
 public interface OnClickListener { void onClick(View v); }
 public View(android.content.Context c){} public void setVisibility(int v){} public int getVisibility(){return 0;}
 public boolean requestFocus(int d){return true;} public boolean requestFocus(){return true;} public void setFocusable(boolean b){}
 public void setFocusableInTouchMode(boolean b){} public void setOnClickListener(OnClickListener l){} public <T extends View> T findViewById(int id){return null;}
 public void setSystemUiVisibility(int v){} public void setBackgroundColor(int c){} public void setTag(Object t){} public Object getTag(){return null;} }""")
w("android/view/ViewGroup.java", """package android.view; public class ViewGroup extends View { public ViewGroup(android.content.Context c){super(c);}
 public static class LayoutParams { public static final int MATCH_PARENT=-1; public LayoutParams(int w,int h){} }
 public void addView(View v){} public void addView(View v,LayoutParams p){} public void removeView(View v){} }""")
w("android/view/inputmethod/InputMethodManager.java", "package android.view.inputmethod; public class InputMethodManager { public static final int SHOW_IMPLICIT=1; public boolean showSoftInput(android.view.View v,int f){return true;} }")
w("android/widget/FrameLayout.java", """package android.widget; public class FrameLayout extends android.view.ViewGroup { public FrameLayout(android.content.Context c){super(c);}
 public static class LayoutParams extends android.view.ViewGroup.LayoutParams { public LayoutParams(int w,int h){super(w,h);} } }""")
w("android/widget/TextView.java", "package android.widget; public class TextView extends android.view.View { public TextView(android.content.Context c){super(c);} public void setText(CharSequence t){} public void setText(int r){} }")
w("android/widget/Button.java", "package android.widget; public class Button extends TextView { public Button(android.content.Context c){super(c);} }")
w("android/widget/CompoundButton.java", """package android.widget; public class CompoundButton extends Button { public CompoundButton(android.content.Context c){super(c);}
 public interface OnCheckedChangeListener { void onCheckedChanged(CompoundButton b,boolean checked); }
 public void setChecked(boolean b){} public void setOnCheckedChangeListener(OnCheckedChangeListener l){} }""")
w("android/widget/CheckBox.java", "package android.widget; public class CheckBox extends CompoundButton { public CheckBox(android.content.Context c){super(c);} }")
w("android/widget/RadioButton.java", "package android.widget; public class RadioButton extends CompoundButton { public RadioButton(android.content.Context c){super(c);} }")
w("android/widget/RadioGroup.java", """package android.widget; public class RadioGroup extends android.view.ViewGroup { public RadioGroup(android.content.Context c){super(c);}
 public interface OnCheckedChangeListener { void onCheckedChanged(RadioGroup g,int checkedId); } public void setOnCheckedChangeListener(OnCheckedChangeListener l){} }""")
w("android/widget/Toast.java", """package android.widget; public class Toast { public static final int LENGTH_SHORT=0, LENGTH_LONG=1;
 public static Toast makeText(android.content.Context c,int r,int d){return null;} public static Toast makeText(android.content.Context c,CharSequence t,int d){return null;} public void show(){} }""")
w("android/webkit/JavascriptInterface.java", "package android.webkit; public @interface JavascriptInterface {}")
w("android/webkit/ValueCallback.java", "package android.webkit; public interface ValueCallback<T> { void onReceiveValue(T v); }")
w("android/webkit/WebSettings.java", """package android.webkit; public abstract class WebSettings { public static final int MIXED_CONTENT_ALWAYS_ALLOW=0, LOAD_DEFAULT=-1;
 public abstract void setJavaScriptEnabled(boolean b); public abstract void setDomStorageEnabled(boolean b); public abstract void setDatabaseEnabled(boolean b);
 public abstract void setMediaPlaybackRequiresUserGesture(boolean b); public abstract void setMixedContentMode(int m); public abstract void setUseWideViewPort(boolean b);
 public abstract void setLoadWithOverviewMode(boolean b); public abstract void setSupportZoom(boolean b); public abstract void setBuiltInZoomControls(boolean b);
 public abstract void setDisplayZoomControls(boolean b); public abstract void setTextZoom(int z); public abstract void setAllowFileAccess(boolean b);
 public abstract void setAllowContentAccess(boolean b); public abstract void setCacheMode(int m); public abstract void setJavaScriptCanOpenWindowsAutomatically(boolean b);
 public abstract void setUserAgentString(String ua); public abstract String getUserAgentString(); public static String getDefaultUserAgent(android.content.Context c){return "";} }""")
w("android/webkit/WebResourceRequest.java", "package android.webkit; public interface WebResourceRequest { android.net.Uri getUrl(); boolean isForMainFrame(); }")
w("android/webkit/WebResourceError.java", "package android.webkit; public abstract class WebResourceError { public abstract CharSequence getDescription(); public abstract int getErrorCode(); }")
w("android/webkit/WebViewClient.java", """package android.webkit; public class WebViewClient { public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return false;}
 public void onReceivedError(WebView v,WebResourceRequest r,WebResourceError e){} public void onPageFinished(WebView v,String url){} }""")
w("android/webkit/WebChromeClient.java", """package android.webkit; public class WebChromeClient { public interface CustomViewCallback { void onCustomViewHidden(); }
 public void onShowCustomView(android.view.View v,CustomViewCallback c){} public void onHideCustomView(){} }""")
w("android/webkit/WebView.java", """package android.webkit; public class WebView extends android.view.ViewGroup { public WebView(android.content.Context c){super(c);}
 public static void setWebContentsDebuggingEnabled(boolean b){} public WebSettings getSettings(){return null;} public void addJavascriptInterface(Object o,String n){}
 public void setWebViewClient(WebViewClient c){} public void setWebChromeClient(WebChromeClient c){} public void loadUrl(String u){}
 public void evaluateJavascript(String s,ValueCallback<String> cb){} public void onResume(){} public void onPause(){} public void resumeTimers(){}
 public void destroy(){} public void clearCache(boolean b){} public static android.content.pm.PackageInfo getCurrentWebViewPackage(){return null;} }""")
w("android/webkit/WebStorage.java", "package android.webkit; public class WebStorage { public static WebStorage getInstance(){return null;} public void deleteAllData(){} }")
w("android/webkit/CookieManager.java", "package android.webkit; public class CookieManager { public static CookieManager getInstance(){return null;} public void removeAllCookies(ValueCallback<Boolean> cb){} public void flush(){} }")

# --------------------------------------------------------------- nanohttpd
w("fi/iki/elonen/NanoHTTPD.java", """package fi.iki.elonen; import java.util.*; import java.io.*;
public abstract class NanoHTTPD { public static final int SOCKET_READ_TIMEOUT=5000;
 public enum Method { GET, PUT, POST, DELETE, HEAD, OPTIONS, TRACE, CONNECT, PATCH, PROPFIND, PROPPATCH, MKCOL, MOVE, COPY, LOCK, UNLOCK }
 public NanoHTTPD(String host,int port){} public void start(int timeout,boolean daemon) throws IOException {} public boolean isAlive(){return true;} public void stop(){}
 public abstract Response serve(IHTTPSession s);
 public interface IHTTPSession { String getUri(); Method getMethod(); Map<String,List<String>> getParameters(); Map<String,String> getHeaders();
  void parseBody(Map<String,String> files) throws IOException, ResponseException; }
 public static final class ResponseException extends Exception { public Response.Status getStatus(){return null;} }
 public static class Response { public interface IStatus { String getDescription(); int getRequestStatus(); }
  public enum Status implements IStatus { OK(200,"OK"), NOT_FOUND(404,"Not Found"), INTERNAL_ERROR(500,"Internal Server Error"), BAD_REQUEST(400,"Bad Request"),
   FORBIDDEN(403,"Forbidden"), NOT_IMPLEMENTED(501,"Not Implemented"), NO_CONTENT(204,"No Content");
   private final int s; private final String d; Status(int s,String d){this.s=s;this.d=d;} public String getDescription(){return s+" "+d;} public int getRequestStatus(){return s;} }
  public void addHeader(String n,String v){} public void setGzipEncoding(boolean b){} }
 public static Response newFixedLengthResponse(Response.IStatus st,String mime,InputStream data,long len){return null;}
 public static Response newFixedLengthResponse(Response.IStatus st,String mime,String txt){return null;} }""")

# -------------------------------------------------------------------- R
ids, strings, layouts, drawables, mipmaps = set(), set(), set(), set(), set()
for f in glob.glob(os.path.join(RES, "layout", "*.xml")):
    layouts.add(os.path.basename(f)[:-4])
    ids.update(re.findall(r'android:id="@\+id/([A-Za-z0-9_]+)"', open(f).read()))
for f in glob.glob(os.path.join(RES, "values*", "strings.xml")):
    strings.update(re.findall(r'<string name="([A-Za-z0-9_]+)"', open(f).read()))
for f in glob.glob(os.path.join(RES, "drawable*", "*")):
    drawables.add(os.path.basename(f).split(".")[0])
for f in glob.glob(os.path.join(RES, "mipmap*", "*")):
    mipmaps.add(os.path.basename(f).split(".")[0])
def consts(names):
    return "".join(f"  public static final int {n}={i+1};\n" for i, n in enumerate(sorted(names)))
w("org/tvshell/iptvnator/R.java", "package org.tvshell.iptvnator; public final class R {\n"
  f" public static final class id {{\n{consts(ids)} }}\n public static final class string {{\n{consts(strings)} }}\n"
  f" public static final class layout {{\n{consts(layouts)} }}\n public static final class drawable {{\n{consts(drawables)} }}\n"
  f" public static final class mipmap {{\n{consts(mipmaps)} }}\n}}\n")
print("stubs written to", OUT, "| ids:", len(ids), "strings:", len(strings))
