const { withAppDelegate, withInfoPlist } = require('@expo/config-plugins');

const SCENE_DELEGATE_MARKER = '// @generated begin vouch-scene-lifecycle';

function withSceneManifest(config) {
  return withInfoPlist(config, (nextConfig) => {
    nextConfig.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: 'SceneDelegate',
          },
        ],
      },
    };
    return nextConfig;
  });
}

function withSceneDelegate(config) {
  return withAppDelegate(config, (nextConfig) => {
    if (nextConfig.modResults.language !== 'swift') {
      throw new Error('[withSceneLifecycle] A Swift AppDelegate is required.');
    }

    const contents = nextConfig.modResults.contents;
    if (contents.includes(SCENE_DELEGATE_MARKER) || contents.includes('@objc(SceneDelegate)')) {
      return nextConfig;
    }

    nextConfig.modResults.contents = `${contents.trimEnd()}\n\n${buildSceneDelegateSource()}\n`;
    return nextConfig;
  });
}

function buildSceneDelegateSource() {
  return `${SCENE_DELEGATE_MARKER}
@objc(SceneDelegate)
public class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  public var window: UIWindow?

  public func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard
      let windowScene = scene as? UIWindowScene,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let appWindow = appDelegate.window
    else {
      return
    }

    appWindow.windowScene = windowScene
    window = appWindow
    appWindow.makeKeyAndVisible()

    if let urlContext = connectionOptions.urlContexts.first {
      open(urlContext)
    }
  }

  public func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let urlContext = URLContexts.first else { return }
    open(urlContext)
  }

  public func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = RCTLinkingManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in }
    )
  }

  private func open(_ urlContext: UIOpenURLContext) {
    _ = RCTLinkingManager.application(
      UIApplication.shared,
      open: urlContext.url,
      options: [.openInPlace: urlContext.options.openInPlace]
    )
  }
}
// @generated end vouch-scene-lifecycle`;
}

module.exports = function withSceneLifecycle(config) {
  config = withSceneManifest(config);
  config = withSceneDelegate(config);
  return config;
};
