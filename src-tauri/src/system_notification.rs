#[cfg(target_os = "macos")]
pub(crate) fn notify_clipboard_copied(text: &str) -> Result<(), String> {
    let body = text.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        if let Err(e) = notify_clipboard_copied_now(&body) {
            eprintln!("[notification] failed to show clipboard notification: {e}");
        }
    });

    Ok(())
}

#[cfg(target_os = "macos")]
fn notify_clipboard_copied_now(text: &str) -> Result<(), String> {
    use block2::RcBlock;
    use objc2::runtime::{AnyObject, Bool};
    use objc2::{class, msg_send};

    #[link(name = "UserNotifications", kind = "framework")]
    extern "C" {}

    if !is_running_from_macos_app_bundle() {
        return Err("macOS notifications require running from a .app bundle; skipping in dev binary".into());
    }

    let body = text.to_string();
    let authorization_handler = RcBlock::new(move |granted: Bool, error: *mut AnyObject| {
        if !error.is_null() {
            eprintln!("[notification] failed to request notification authorization");
            return;
        }
        if !granted.as_bool() {
            eprintln!("[notification] notification authorization was not granted");
            return;
        }

        if let Err(e) = send_macos_notification(&body) {
            eprintln!("[notification] failed to show clipboard notification: {e}");
        }
    });

    let center: *mut AnyObject = unsafe {
        msg_send![class!(UNUserNotificationCenter), currentNotificationCenter]
    };
    if center.is_null() {
        return Err("UNUserNotificationCenter is unavailable".into());
    }

    let options = (1usize << 1) | (1usize << 2);
    let _: () = unsafe {
        msg_send![
            center,
            requestAuthorizationWithOptions: options,
            completionHandler: &*authorization_handler
        ]
    };

    Ok(())
}

#[cfg(target_os = "macos")]
fn is_running_from_macos_app_bundle() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|path| {
            path.ancestors()
                .find(|ancestor| ancestor.extension().is_some_and(|ext| ext == "app"))
                .map(|_| ())
        })
        .is_some()
}

#[cfg(target_os = "macos")]
fn send_macos_notification(text: &str) -> Result<(), String> {
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::NSString;
    use std::ptr;
    use std::time::{SystemTime, UNIX_EPOCH};

    let center: *mut AnyObject = unsafe {
        msg_send![class!(UNUserNotificationCenter), currentNotificationCenter]
    };
    if center.is_null() {
        return Err("UNUserNotificationCenter is unavailable".into());
    }

    let content: Retained<AnyObject> = unsafe {
        msg_send![class!(UNMutableNotificationContent), new]
    };
    let title = NSString::from_str("Copied");
    let body = NSString::from_str(text);
    unsafe {
        let _: () = msg_send![&*content, setTitle: &*title];  
        let _: () = msg_send![&*content, setBody: &*body];
    }

    let sound_name = NSString::from_str("Frog.aiff");
    let sound: *mut AnyObject = unsafe {
        msg_send![class!(UNNotificationSound), soundNamed: &*sound_name]
    };
    if !sound.is_null() {
        unsafe {
            let _: () = msg_send![&*content, setSound: sound];
        }
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let identifier = NSString::from_str(&format!("quick-copy-{now}"));
    let request: Retained<AnyObject> = unsafe {
        msg_send![
            class!(UNNotificationRequest),
            requestWithIdentifier: &*identifier,
            content: &*content,
            trigger: ptr::null_mut::<AnyObject>()
        ]
    };

    let completion_handler = RcBlock::new(|error: *mut AnyObject| {
        if !error.is_null() {
            eprintln!("[notification] failed to add notification request");
        }
    });
    unsafe {
        let _: () = msg_send![
            center,
            addNotificationRequest: &*request,
            withCompletionHandler: &*completion_handler
        ];
    }

    Ok(())
}

#[cfg(target_os = "windows")]
pub(crate) fn notify_clipboard_copied(_text: &str) -> Result<(), String> {
    // TODO(windows): Use a native Windows toast notification after the macOS path is settled.
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(crate) fn notify_clipboard_copied(_text: &str) -> Result<(), String> {
    Ok(())
}
