package app.grabit.student;

import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.tasks.Task;

@CapacitorPlugin(name = "NativeGoogleAuth")
public class NativeGoogleAuthPlugin extends Plugin {

    @PluginMethod
    public void signIn(PluginCall call) {
        String clientId = call.getString("clientId");

        GoogleSignInOptions.Builder builder = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestEmail();

        if (clientId != null && !clientId.isEmpty()) {
            builder.requestIdToken(clientId);
        }

        GoogleSignInOptions gso = builder.build();
        GoogleSignInClient client = GoogleSignIn.getClient(getActivity(), gso);

        // Explicitly signOut before launching sign in so the native Google Account Picker
        // is forced to display available device accounts every time.
        client.signOut().addOnCompleteListener(getActivity(), task -> {
            Intent signInIntent = client.getSignInIntent();
            startActivityForResult(call, signInIntent, "handleSignInResult");
        });
    }

    @ActivityCallback
    private void handleSignInResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        Intent data = result.getData();
        Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(data);
        try {
            GoogleSignInAccount account = task.getResult(ApiException.class);
            if (account != null) {
                JSObject ret = new JSObject();
                ret.put("idToken", account.getIdToken());
                ret.put("serverAuthCode", account.getServerAuthCode());
                ret.put("email", account.getEmail());
                ret.put("displayName", account.getDisplayName());
                ret.put("givenName", account.getGivenName());
                ret.put("familyName", account.getFamilyName());
                call.resolve(ret);
            } else {
                call.reject("Google Sign In failed: account null");
            }
        } catch (ApiException e) {
            int statusCode = e.getStatusCode();
            if (statusCode == 12501) { // SIGN_IN_CANCELLED
                call.reject("USER_CANCELLED", "12501");
            } else if (statusCode == 10) { // DEVELOPER_ERROR
                call.reject("DEVELOPER_ERROR (10): NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID missing/invalid or SHA-1 fingerprint mismatch in Google Cloud Console.", "10");
            } else {
                call.reject("Google Sign In failed with code " + statusCode + ": " + e.getMessage(), String.valueOf(statusCode));
            }
        }
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        GoogleSignInOptions gso = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN).build();
        GoogleSignInClient client = GoogleSignIn.getClient(getActivity(), gso);
        client.signOut().addOnCompleteListener(getActivity(), task -> {
            call.resolve();
        });
    }
}
