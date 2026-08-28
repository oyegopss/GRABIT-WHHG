package com.grabit.vendor;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONException;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "ThermalPrinter",
    permissions = {
        @Permission(
            strings = {
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_CONNECT
            },
            alias = "bluetooth"
        ),
        @Permission(
            strings = {
                Manifest.permission.POST_NOTIFICATIONS
            },
            alias = "notifications"
        )
    }
)
public class ThermalPrinterPlugin extends Plugin {

    private static final String TAG = "ThermalPrinterPlugin";
    // Standard SerialPortServiceClass_UUID (SPP) for ESC/POS thermal printers
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final String PERMISSION_CHANNEL_ID = "grabit_permissions_channel";
    private static final String PERMISSION_CHANNEL_NAME = "GRABIT Permissions";

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private BluetoothAdapter bluetoothAdapter;
    private BluetoothSocket activeBtSocket = null;
    private String connectedBtAddress = null;
    private BroadcastReceiver scanReceiver = null;
    private boolean isScanning = false;

    @Override
    public void load() {
        super.load();
        createNotificationChannel();
        BluetoothManager bm = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        if (bm != null) {
            bluetoothAdapter = bm.getAdapter();
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                PERMISSION_CHANNEL_ID,
                PERMISSION_CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Notifications to help grant essential permissions for GRABIT Vendor");
            channel.enableVibration(true);
            NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    // ==========================================
    // Permissions Management
    // ==========================================

    @PluginMethod
    public void checkPrinterPermissions(PluginCall call) {
        JSObject ret = new JSObject();
        boolean btGranted = hasBluetoothPermissions();
        boolean notifGranted = hasNotificationPermission();
        boolean btEnabled = bluetoothAdapter != null && bluetoothAdapter.isEnabled();

        ret.put("bluetoothGranted", btGranted);
        ret.put("notificationsGranted", notifGranted);
        ret.put("bluetoothEnabled", btEnabled);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPrinterPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (!hasBluetoothPermissions()) {
                requestPermissionForAlias("bluetooth", call, "bluetoothPermissionCallback");
                return;
            }
        }
        checkPrinterPermissions(call);
    }

    @PermissionCallback
    private void bluetoothPermissionCallback(PluginCall call) {
        checkPrinterPermissions(call);
    }

    private boolean hasBluetoothPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
                && ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    private boolean hasNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    // ==========================================
    // Bluetooth Device Listing & Discovery
    // ==========================================

    @PluginMethod
    public void getBondedDevices(PluginCall call) {
        if (!hasBluetoothPermissions()) {
            call.reject("Bluetooth permissions not granted", "PERMISSION_DENIED");
            return;
        }

        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
            call.reject("Bluetooth is disabled or unavailable on this device", "BLUETOOTH_DISABLED");
            return;
        }

        try {
            Set<BluetoothDevice> pairedDevices = bluetoothAdapter.getBondedDevices();
            JSArray devices = new JSArray();

            if (pairedDevices != null) {
                for (BluetoothDevice device : pairedDevices) {
                    JSObject dev = new JSObject();
                    dev.put("name", device.getName() != null ? device.getName() : "Unknown Printer");
                    dev.put("address", device.getAddress());
                    dev.put("type", "bluetooth");
                    dev.put("bonded", true);
                    dev.put("isConnected", device.getAddress().equalsIgnoreCase(connectedBtAddress) && activeBtSocket != null && activeBtSocket.isConnected());
                    devices.put(dev);
                }
            }

            JSObject ret = new JSObject();
            ret.put("devices", devices);
            call.resolve(ret);
        } catch (SecurityException e) {
            call.reject("Security exception accessing Bluetooth devices: " + e.getMessage(), "PERMISSION_DENIED");
        } catch (Exception e) {
            call.reject("Error getting bonded devices: " + e.getMessage());
        }
    }

    @PluginMethod
    public void startScan(PluginCall call) {
        if (!hasBluetoothPermissions()) {
            call.reject("Bluetooth permissions not granted", "PERMISSION_DENIED");
            return;
        }

        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
            call.reject("Bluetooth is disabled", "BLUETOOTH_DISABLED");
            return;
        }

        try {
            stopScanInternal();

            scanReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    String action = intent.getAction();
                    if (BluetoothDevice.ACTION_FOUND.equals(action)) {
                        BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                        if (device != null) {
                            try {
                                JSObject event = new JSObject();
                                event.put("name", device.getName() != null ? device.getName() : "Unknown Device");
                                event.put("address", device.getAddress());
                                event.put("type", "bluetooth");
                                event.put("bonded", device.getBondState() == BluetoothDevice.BOND_BONDED);
                                notifyListeners("printerDiscovered", event);
                            } catch (SecurityException ignored) {}
                        }
                    } else if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(action)) {
                        isScanning = false;
                        JSObject event = new JSObject();
                        event.put("finished", true);
                        notifyListeners("scanFinished", event);
                    }
                }
            };

            IntentFilter filter = new IntentFilter();
            filter.addAction(BluetoothDevice.ACTION_FOUND);
            filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
            getContext().registerReceiver(scanReceiver, filter);

            if (bluetoothAdapter.isDiscovering()) {
                bluetoothAdapter.cancelDiscovery();
            }
            bluetoothAdapter.startDiscovery();
            isScanning = true;

            JSObject ret = new JSObject();
            ret.put("scanning", true);
            call.resolve(ret);
        } catch (SecurityException e) {
            call.reject("Security exception starting scan: " + e.getMessage(), "PERMISSION_DENIED");
        } catch (Exception e) {
            call.reject("Failed to start scan: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopScan(PluginCall call) {
        stopScanInternal();
        JSObject ret = new JSObject();
        ret.put("scanning", false);
        call.resolve(ret);
    }

    private void stopScanInternal() {
        if (isScanning && bluetoothAdapter != null) {
            try {
                bluetoothAdapter.cancelDiscovery();
            } catch (SecurityException ignored) {}
        }
        if (scanReceiver != null) {
            try {
                getContext().unregisterReceiver(scanReceiver);
            } catch (Exception ignored) {}
            scanReceiver = null;
        }
        isScanning = false;
    }

    // ==========================================
    // Bluetooth Connection & Printing
    // ==========================================

    @PluginMethod
    public void connect(PluginCall call) {
        String address = call.getString("address");
        if (address == null || address.isEmpty()) {
            call.reject("Device address is required");
            return;
        }

        if (!hasBluetoothPermissions()) {
            call.reject("Bluetooth permissions not granted", "PERMISSION_DENIED");
            return;
        }

        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
            call.reject("Bluetooth is disabled", "BLUETOOTH_DISABLED");
            return;
        }

        executor.execute(() -> {
            try {
                // If already connected to this address
                if (activeBtSocket != null && activeBtSocket.isConnected() && address.equalsIgnoreCase(connectedBtAddress)) {
                    mainHandler.post(() -> {
                        JSObject ret = new JSObject();
                        ret.put("connected", true);
                        ret.put("address", address);
                        call.resolve(ret);
                    });
                    return;
                }

                disconnectInternal();

                BluetoothDevice device = bluetoothAdapter.getRemoteDevice(address);
                if (device == null) {
                    mainHandler.post(() -> call.reject("Bluetooth device not found", "DEVICE_NOT_FOUND"));
                    return;
                }

                try {
                    bluetoothAdapter.cancelDiscovery();
                } catch (SecurityException ignored) {}

                BluetoothSocket socket = null;
                try {
                    socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                    socket.connect();
                } catch (IOException e) {
                    // Fallback to reflection method for certain ESC/POS mini printers
                    try {
                        socket = (BluetoothSocket) device.getClass().getMethod("createRfcommSocket", int.class).invoke(device, 1);
                        if (socket != null) {
                            socket.connect();
                        }
                    } catch (Exception ex) {
                        if (socket != null) {
                            try { socket.close(); } catch (Exception ignored) {}
                        }
                        throw new IOException("Unable to connect to printer RFCOMM socket: " + e.getMessage());
                    }
                }

                activeBtSocket = socket;
                connectedBtAddress = address;

                mainHandler.post(() -> {
                    JSObject ret = new JSObject();
                    ret.put("connected", true);
                    ret.put("address", address);
                    call.resolve(ret);
                });

            } catch (SecurityException e) {
                mainHandler.post(() -> call.reject("Bluetooth permission denied: " + e.getMessage(), "PERMISSION_DENIED"));
            } catch (Exception e) {
                mainHandler.post(() -> call.reject("Could not connect to printer: " + e.getMessage(), "CONNECTION_FAILED"));
            }
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        executor.execute(() -> {
            disconnectInternal();
            mainHandler.post(() -> {
                JSObject ret = new JSObject();
                ret.put("connected", false);
                call.resolve(ret);
            });
        });
    }

    private synchronized void disconnectInternal() {
        if (activeBtSocket != null) {
            try {
                activeBtSocket.close();
            } catch (Exception ignored) {}
            activeBtSocket = null;
        }
        connectedBtAddress = null;
    }

    @PluginMethod
    public void isConnected(PluginCall call) {
        boolean connected = activeBtSocket != null && activeBtSocket.isConnected();
        JSObject ret = new JSObject();
        ret.put("connected", connected);
        ret.put("address", connectedBtAddress);
        call.resolve(ret);
    }

    @PluginMethod
    public void printRaw(PluginCall call) {
        String base64Data = call.getString("data");
        if (base64Data == null || base64Data.isEmpty()) {
            call.reject("Data is required");
            return;
        }

        executor.execute(() -> {
            if (activeBtSocket == null || !activeBtSocket.isConnected()) {
                mainHandler.post(() -> call.reject("Printer is not connected", "NOT_CONNECTED"));
                return;
            }

            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                OutputStream os = activeBtSocket.getOutputStream();
                os.write(bytes);
                os.flush();

                mainHandler.post(() -> {
                    JSObject ret = new JSObject();
                    ret.put("success", true);
                    ret.put("bytesWritten", bytes.length);
                    call.resolve(ret);
                });
            } catch (Exception e) {
                disconnectInternal();
                mainHandler.post(() -> call.reject("Print failed: " + e.getMessage(), "PRINT_FAILED"));
            }
        });
    }

    // ==========================================
    // Wi-Fi / Network ESC/POS Support
    // ==========================================

    @PluginMethod
    public void printWifi(PluginCall call) {
        String ip = call.getString("ip");
        int port = call.getInt("port", 9100);
        String base64Data = call.getString("data");
        int timeoutMs = call.getInt("timeout", 5000);

        if (ip == null || ip.trim().isEmpty() || base64Data == null) {
            call.reject("IP address and data are required");
            return;
        }

        executor.execute(() -> {
            Socket socket = null;
            try {
                socket = new Socket();
                socket.connect(new InetSocketAddress(ip.trim(), port), timeoutMs);
                socket.setSoTimeout(timeoutMs);

                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                OutputStream os = socket.getOutputStream();
                os.write(bytes);
                os.flush();

                mainHandler.post(() -> {
                    JSObject ret = new JSObject();
                    ret.put("success", true);
                    ret.put("bytesWritten", bytes.length);
                    call.resolve(ret);
                });
            } catch (Exception e) {
                mainHandler.post(() -> call.reject("Wi-Fi print failed: " + e.getMessage(), "WIFI_PRINT_FAILED"));
            } finally {
                if (socket != null) {
                    try { socket.close(); } catch (Exception ignored) {}
                }
            }
        });
    }

    // ==========================================
    // USB Thermal Printer OTG Support
    // ==========================================

    @PluginMethod
    public void getUsbPrinters(PluginCall call) {
        UsbManager usbManager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        if (usbManager == null) {
            call.reject("USB manager not available");
            return;
        }

        Map<String, UsbDevice> deviceList = usbManager.getDeviceList();
        JSArray devices = new JSArray();

        for (UsbDevice device : deviceList.values()) {
            boolean isPrinter = false;
            for (int i = 0; i < device.getInterfaceCount(); i++) {
                UsbInterface intf = device.getInterface(i);
                if (intf.getInterfaceClass() == UsbConstants.USB_CLASS_PRINTER ||
                    intf.getInterfaceClass() == UsbConstants.USB_CLASS_VENDOR_SPEC ||
                    intf.getInterfaceClass() == UsbConstants.USB_CLASS_CDC_DATA) {
                    isPrinter = true;
                    break;
                }
            }

            if (isPrinter || device.getVendorId() != 0) {
                JSObject dev = new JSObject();
                dev.put("name", device.getProductName() != null ? device.getProductName() : "USB Printer (" + device.getDeviceId() + ")");
                dev.put("deviceId", device.getDeviceId());
                dev.put("vendorId", device.getVendorId());
                dev.put("productId", device.getProductId());
                dev.put("type", "usb");
                dev.put("hasPermission", usbManager.hasPermission(device));
                devices.put(dev);
            }
        }

        JSObject ret = new JSObject();
        ret.put("devices", devices);
        call.resolve(ret);
    }

    @PluginMethod
    public void printUsb(PluginCall call) {
        int deviceId = call.getInt("deviceId", -1);
        String base64Data = call.getString("data");

        if (deviceId == -1 || base64Data == null) {
            call.reject("Device ID and data are required");
            return;
        }

        UsbManager usbManager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        if (usbManager == null) {
            call.reject("USB manager not available");
            return;
        }

        UsbDevice targetDevice = null;
        for (UsbDevice dev : usbManager.getDeviceList().values()) {
            if (dev.getDeviceId() == deviceId) {
                targetDevice = dev;
                break;
            }
        }

        if (targetDevice == null) {
            call.reject("USB device not found", "DEVICE_NOT_FOUND");
            return;
        }

        if (!usbManager.hasPermission(targetDevice)) {
            call.reject("USB permission not granted for printer", "PERMISSION_DENIED");
            return;
        }

        final UsbDevice finalTarget = targetDevice;
        executor.execute(() -> {
            UsbDeviceConnection connection = null;
            UsbInterface usbInterface = null;
            try {
                usbInterface = finalTarget.getInterface(0);
                UsbEndpoint endpoint = null;
                for (int i = 0; i < usbInterface.getEndpointCount(); i++) {
                    UsbEndpoint ep = usbInterface.getEndpoint(i);
                    if (ep.getDirection() == UsbConstants.USB_DIR_OUT) {
                        endpoint = ep;
                        break;
                    }
                }

                if (endpoint == null) {
                    mainHandler.post(() -> call.reject("No USB output endpoint found", "USB_NO_ENDPOINT"));
                    return;
                }

                connection = usbManager.openDevice(finalTarget);
                if (connection == null) {
                    mainHandler.post(() -> call.reject("Could not open USB device connection", "USB_OPEN_FAILED"));
                    return;
                }

                connection.claimInterface(usbInterface, true);
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                int transferred = connection.bulkTransfer(endpoint, bytes, bytes.length, 5000);

                if (transferred >= 0) {
                    mainHandler.post(() -> {
                        JSObject ret = new JSObject();
                        ret.put("success", true);
                        ret.put("bytesWritten", transferred);
                        call.resolve(ret);
                    });
                } else {
                    mainHandler.post(() -> call.reject("USB bulk transfer failed with code: " + transferred, "USB_TRANSFER_FAILED"));
                }
            } catch (Exception e) {
                mainHandler.post(() -> call.reject("USB Print Error: " + e.getMessage(), "USB_ERROR"));
            } finally {
                if (connection != null) {
                    try {
                        if (usbInterface != null) connection.releaseInterface(usbInterface);
                        connection.close();
                    } catch (Exception ignored) {}
                }
            }
        });
    }

    // ==========================================
    // Permission Settings Notification System
    // ==========================================

    @PluginMethod
    public void showPermissionNotification(PluginCall call) {
        String permissionType = call.getString("permissionType", "bluetooth");
        String title = call.getString("title", "GRABIT Vendor — Permission Required");
        String message = call.getString("message", "Bluetooth permission is required to connect and print using your thermal printer. Tap here to enable it.");

        try {
            int notifId = getNotificationIdForPermission(permissionType);

            // Intent to open Application Settings Details
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            Uri uri = Uri.fromParts("package", getContext().getPackageName(), null);
            intent.setData(uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

            PendingIntent pendingIntent = PendingIntent.getActivity(
                getContext(),
                notifId,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
            );

            int appIcon = getContext().getApplicationInfo().icon;
            if (appIcon == 0) {
                appIcon = android.R.drawable.stat_notify_error;
            }

            NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), PERMISSION_CHANNEL_ID)
                .setSmallIcon(appIcon)
                .setContentTitle(title)
                .setContentText(message)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(message))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ERROR)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent);

            NotificationManagerCompat notificationManager = NotificationManagerCompat.from(getContext());
            if (hasNotificationPermission()) {
                notificationManager.notify(notifId, builder.build());
                JSObject ret = new JSObject();
                ret.put("posted", true);
                ret.put("notificationId", notifId);
                call.resolve(ret);
            } else {
                call.reject("Notification permission not granted to post system notification");
            }
        } catch (Exception e) {
            call.reject("Failed to show permission notification: " + e.getMessage());
        }
    }

    @PluginMethod
    public void clearPermissionNotification(PluginCall call) {
        String permissionType = call.getString("permissionType", "bluetooth");
        try {
            int notifId = getNotificationIdForPermission(permissionType);
            NotificationManagerCompat notificationManager = NotificationManagerCompat.from(getContext());
            notificationManager.cancel(notifId);
            JSObject ret = new JSObject();
            ret.put("cleared", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to clear notification: " + e.getMessage());
        }
    }

    private int getNotificationIdForPermission(String type) {
        switch (type.toLowerCase()) {
            case "bluetooth":
                return 1001;
            case "camera":
                return 1002;
            case "location":
                return 1003;
            case "notifications":
                return 1004;
            default:
                return 1000;
        }
    }

    @Override
    protected void handleOnDestroy() {
        stopScanInternal();
        disconnectInternal();
        executor.shutdown();
        super.handleOnDestroy();
    }
}
