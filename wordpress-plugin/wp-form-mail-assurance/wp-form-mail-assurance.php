<?php
/**
 * Plugin Name: WP Form & Mail Assurance Helper
 * Description: Signed synthetic delivery checks for explicitly connected Contact Form 7 sites.
 * Version: 0.1.0
 * Requires PHP: 8.0
 */

if (!defined('ABSPATH')) { exit; }

final class WFMA_Helper {
    private const OPTION_SECRET = 'wfma_site_secret';
    private const OPTION_ORACLE = 'wfma_oracle_email';
    private const OPTION_SITE_ID = 'wfma_site_id';
    private static ?string $test_id = null;
    private static bool $force_smtp_failure = false;
    private static string $last_mail_error = '';

    public static function boot(): void {
        add_action('rest_api_init', [self::class, 'routes']);
        add_filter('wpcf7_mail_components', [self::class, 'redirect_synthetic_mail'], 100, 3);
        add_action('phpmailer_init', [self::class, 'configure_proof_smtp']);
        add_action('wp_mail_failed', [self::class, 'capture_mail_error']);
        add_action('admin_menu', [self::class, 'admin_menu']);
        add_action('admin_post_wfma_connect', [self::class, 'connect']);
    }

    private static function api_url(): string {
        return defined('WFMA_API_URL') ? rtrim((string) WFMA_API_URL, '/') : 'https://wp-form-mail-assurance-api.wordpress-form-mail-assurance.workers.dev';
    }

    public static function admin_menu(): void {
        add_options_page('Form & Mail Assurance', 'Form & Mail Assurance', 'manage_options', 'wfma', [self::class, 'settings_page']);
    }

    public static function settings_page(): void {
        if (!current_user_can('manage_options')) return;
        $site_id = (string) get_option(self::OPTION_SITE_ID, '');
        $status = sanitize_text_field((string) ($_GET['wfma_status'] ?? ''));
        ?>
        <div class="wrap"><h1>WordPress Form &amp; Mail Assurance</h1>
        <?php if ($status !== ''): ?><div class="notice notice-<?php echo $status === 'connected' ? 'success' : 'error'; ?>"><p><?php echo $status === 'connected' ? 'Connected. Automatic discovery and the first delivery test are scheduled.' : 'Connection failed. The token may be invalid, expired, over its site limit, or this site is unsupported.'; ?></p></div><?php endif; ?>
        <?php if ($site_id !== ''): ?>
            <p><strong>Status:</strong> CONNECTED</p><p><strong>Site ID:</strong> <code><?php echo esc_html($site_id); ?></code></p>
            <p>Monitoring, retries, incidents and recovery run remotely. No WordPress administrator action is required.</p>
        <?php else: ?>
            <p>Paste the agency connection token shown after Stripe Checkout. The same 24-hour token can connect each site included in the plan. The helper sends the site URL and locally discovered form identifiers to the assurance service.</p>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <input type="hidden" name="action" value="wfma_connect"><?php wp_nonce_field('wfma_connect'); ?>
                <table class="form-table"><tr><th><label for="wfma_token">Activation token</label></th><td><input id="wfma_token" name="activation_token" type="password" class="regular-text" autocomplete="off" required></td></tr></table>
                <?php submit_button('Connect and start automatic test'); ?>
            </form>
        <?php endif; ?></div>
        <?php
    }

    public static function connect(): void {
        if (!current_user_can('manage_options')) wp_die('Forbidden', 403);
        check_admin_referer('wfma_connect');
        $token = sanitize_text_field((string) ($_POST['activation_token'] ?? ''));
        $forms = [];
        if (defined('WPCF7_VERSION')) {
            foreach (WPCF7_ContactForm::find() as $form) {
                $forms[] = ['id' => (string) $form->id(), 'title' => $form->title(), 'provider' => 'contact-form-7', 'status' => 'SUPPORTED'];
            }
        }
        $response = wp_remote_post(self::api_url() . '/api/plugin/connect', [
            'timeout' => 20,
            'headers' => ['content-type' => 'application/json'],
            'body' => wp_json_encode(['activation_token' => $token, 'site_url' => home_url('/'), 'forms' => $forms]),
        ]);
        $ok = !is_wp_error($response) && wp_remote_retrieve_response_code($response) === 201;
        if ($ok) {
            $data = json_decode((string) wp_remote_retrieve_body($response), true);
            if (empty($data['site_id']) || empty($data['site_secret'])) $ok = false;
            else {
                update_option(self::OPTION_SITE_ID, sanitize_text_field((string) $data['site_id']), false);
                update_option(self::OPTION_SECRET, sanitize_text_field((string) $data['site_secret']), false);
                update_option(self::OPTION_ORACLE, 'wpformmailassurance@gmail.com', false);
            }
        }
        wp_safe_redirect(admin_url('options-general.php?page=wfma&wfma_status=' . ($ok ? 'connected' : 'failed')));
        exit;
    }

    public static function routes(): void {
        register_rest_route('wfma/v1', '/forms', [
            'methods' => 'GET',
            'permission_callback' => [self::class, 'authenticate'],
            'callback' => [self::class, 'forms'],
        ]);
        register_rest_route('wfma/v1', '/synthetic', [
            'methods' => 'POST',
            'permission_callback' => [self::class, 'authenticate'],
            'callback' => [self::class, 'synthetic'],
        ]);
    }

    public static function authenticate(WP_REST_Request $request): bool {
        $secret = (string) get_option(self::OPTION_SECRET, '');
        $timestamp = (string) $request->get_header('x-wfma-timestamp');
        $signature = (string) $request->get_header('x-wfma-signature');
        if ($secret === '' || !ctype_digit($timestamp) || abs(time() - (int) $timestamp) > 300) return false;
        $expected = hash_hmac('sha256', $timestamp . '.' . $request->get_body(), $secret);
        return hash_equals($expected, $signature);
    }

    public static function forms(): WP_REST_Response {
        if (!defined('WPCF7_VERSION')) return new WP_REST_Response(['status' => 'UNSUPPORTED — NOT MONITORED'], 422);
        $forms = array_map(static fn($form) => [
            'id' => (string) $form->id(),
            'title' => $form->title(),
            'status' => 'SUPPORTED',
        ], WPCF7_ContactForm::find());
        return new WP_REST_Response(['provider' => 'contact-form-7', 'forms' => $forms]);
    }

    public static function synthetic(WP_REST_Request $request): WP_REST_Response {
        if (!defined('WPCF7_VERSION')) return new WP_REST_Response(['status' => 'UNSUPPORTED — NOT MONITORED'], 422);
        $payload = $request->get_json_params();
        $form = WPCF7_ContactForm::get_instance((int) ($payload['form_id'] ?? 0));
        $test_id = sanitize_text_field((string) ($payload['test_id'] ?? ''));
        if (!$form || !preg_match('/^[a-f0-9-]{20,40}$/i', $test_id)) return new WP_REST_Response(['error' => 'invalid_request'], 400);

        self::$test_id = $test_id;
        self::$force_smtp_failure = !empty($payload['force_smtp_failure']);
        self::$last_mail_error = '';
        $sent = WPCF7_Mail::send($form->prop('mail'));
        self::$test_id = null;
        self::$force_smtp_failure = false;
        return new WP_REST_Response([
            'accepted' => (bool) $sent,
            'test_id' => $test_id,
            'error' => $sent ? null : self::$last_mail_error,
        ], $sent ? 202 : 502);
    }

    public static function capture_mail_error(WP_Error $error): void {
        self::$last_mail_error = sanitize_text_field($error->get_error_message());
    }

    public static function redirect_synthetic_mail(array $components, $form, $mail): array {
        if (self::$test_id === null) return $components;
        $oracle = (string) get_option(self::OPTION_ORACLE, 'wpformmailassurance@gmail.com');
        [$local, $domain] = array_pad(explode('@', $oracle, 2), 2, '');
        if ($local === '' || $domain === '') return $components;
        $components['recipient'] = $local . '+' . self::$test_id . '@' . $domain;
        $components['subject'] = '[WFMA TEST ' . self::$test_id . '] ' . ($components['subject'] ?? 'Delivery test');
        $components['body'] = "Synthetic monitoring message. No customer lead was created.\n\n" . ($components['body'] ?? '');
        $components['additional_headers'] = trim(($components['additional_headers'] ?? '') . "\nX-WFMA-Test-ID: " . self::$test_id);
        return $components;
    }

    /** Proof-only SMTP configuration. Customer sites retain their own WordPress/SMTP path. */
    public static function configure_proof_smtp($mailer): void {
        if (!defined('WFMA_PROOF_SMTP_HOST') || !defined('WFMA_PROOF_SMTP_USER') || !defined('WFMA_PROOF_SMTP_PASS')) return;
        $mailer->isSMTP();
        if (self::$force_smtp_failure) {
            $mailer->Host = '127.0.0.1';
            $mailer->Port = 1;
            $mailer->SMTPAuth = false;
            $mailer->Timeout = 2;
            return;
        }
        $mailer->Host = WFMA_PROOF_SMTP_HOST;
        $mailer->Port = defined('WFMA_PROOF_SMTP_PORT') ? (int) WFMA_PROOF_SMTP_PORT : 587;
        $mailer->SMTPAuth = true;
        $mailer->SMTPSecure = 'tls';
        $mailer->SMTPOptions = [
            'ssl' => [
                'verify_peer' => true,
                'verify_peer_name' => true,
                'cafile' => plugin_dir_path(__FILE__) . 'certs/gts-root-r1.pem',
            ],
        ];
        $mailer->Username = WFMA_PROOF_SMTP_USER;
        $mailer->Password = WFMA_PROOF_SMTP_PASS;
        $mailer->From = WFMA_PROOF_SMTP_USER;
        $mailer->FromName = 'WFMA Proof';
    }
}

WFMA_Helper::boot();
