import UIKit
import Capacitor
import WebKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

// Reports the device's real safe-area insets (status bar / Dynamic Island
// at the top, home indicator at the bottom) to the page as the CSS
// variables --safe-top / --safe-bottom (see styles/globals.css). The app
// draws edge to edge (capacitor.config.ts: contentInset 'never') so the
// theme's background fills the status-bar strip, but in that mode this
// WKWebView reports env(safe-area-inset-*) as 0 — verified in the iOS 26
// simulator — so the page has no other way to know how far to keep its
// content clear of the clock and the home indicator.
class MainViewController: CAPBridgeViewController {
    private var lastInsets: UIEdgeInsets?

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        reportSafeArea()
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        reportSafeArea()
    }

    private func reportSafeArea() {
        guard let webView = webView else { return }
        let insets = view.safeAreaInsets
        if insets == lastInsets { return }
        lastInsets = insets
        let js = """
        (function set() {
          var d = document.documentElement;
          if (!d) { return setTimeout(set, 0); }
          d.style.setProperty('--safe-top', '\(insets.top)px');
          d.style.setProperty('--safe-bottom', '\(insets.bottom)px');
        })();
        """
        // Every future page load (a reload, or the site navigating) gets it
        // at document start; the page that's already showing gets it now.
        webView.configuration.userContentController.addUserScript(
            WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView.evaluateJavaScript(js, completionHandler: nil)
    }
}
