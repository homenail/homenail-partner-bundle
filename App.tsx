import AppNavigation from './src/navigation';
import hotUpdate from 'react-native-ota-hot-update';
import * as eva from '@eva-design/eva';
import { ApplicationProvider, Button, Card, Modal, Text, Layout, ProgressBar } from '@ui-kitten/components'; // Giả sử bạn dùng UI Kitten components
import { default as mapping } from './mapping.json';
import { useEffect, useState, useRef } from 'react';
import SplashScreen from 'react-native-splash-screen';
import awsService from './src/app/services/aws.service';
import { useAuthorStore } from './src/zustand/author';
import { isEmpty } from 'lodash';
import httpClient from './src/app/services/httpClient';
import { Alert, Image, Platform, StyleSheet, View } from 'react-native';
import { BgSplash } from './src/assets/images';
import customTheme from './src/utils/CustomTheme';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { DataAppConfig, InitiateAuthResponse } from './src/interface/account.interface';
import AccountServices from './src/app/services/account.service';
import { ApiResponse } from './src/interface/response.interface';
import TextCM from './src/app/components/Text';

const REFRESH_INTERVAL = 10 * 60 * 1000;
const BUNDLE_CONFIG = {
  branch: Platform.OS === 'ios' ? 'ios' : 'android',
  path: Platform.OS === 'ios' ? 'output/main.jsbundle' : 'output/index.android.bundle',
};

export default function App() {
  const [isChecking, setIsChecking] = useState(true);

  const [updateModalVisible, setUpdateModalVisible] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [hasNewUpdate, setHasNewUpdate] = useState(false);
  const [updateMeta, setUpdateMeta] = useState({ force: false, readyToRestart: false, sc_url: '' });
  const [currentVersion, setCurrentVersion] = useState<string>();
  const [infoUpdate, setInfoUpdate] = useState<DataAppConfig>()

  const { resLogin, _hasHydrated, latestVersion, setIsAuthorized, setResLogin, setLatestVersion } = useAuthorStore();
  const intervalId = useRef<NodeJS.Timeout | null>(null);

  const checkServerVersion = async () => {
    try {
      const res = await AccountServices.getListSettingApp(Platform.OS);
      const data = res?.data as ApiResponse<DataAppConfig>;
      const latest_version = data?.data?.latest_version;
      setInfoUpdate(data.data)
      data.data?.title
      data.data?.message
      if (latestVersion != latest_version) {
        setUpdateModalVisible(true);
        setHasNewUpdate(true);
        setCurrentVersion(latest_version);
        setUpdateMeta(prev => ({
          ...prev,
          force: true,
          sc_url: data.data?.sc_url || ''
        }));
      }
    } catch (error) {
      console.error(error);
    }
  };

  const startUpdateProcess = () => {
    setHasNewUpdate(false);
    setIsDownloading(true);
    syncGitData(updateMeta.sc_url);
  };

  const syncGitData = (url: string,) => {
    setIsDownloading(true);
    setUpdateModalVisible(true);
    hotUpdate.git.checkForGitUpdate({
      branch: BUNDLE_CONFIG.branch,
      bundlePath: BUNDLE_CONFIG.path,
      url,
      restartAfterInstall: true,
      onCloneFailed(msg) {
        setIsDownloading(false);
        setUpdateModalVisible(false);
      },
      onPullFailed(msg) {
        setIsDownloading(false);
        setUpdateModalVisible(false);
      },
      onProgress(received, total) {
        if (total > 0) {
          const percent = received / total;
          setDownloadProgress(percent);
        }
      },
      onCloneSuccess() {
        currentVersion && setLatestVersion(currentVersion);
        handleUpdateReady();
      },
      onPullSuccess() {
        currentVersion && setLatestVersion(currentVersion);
        handleUpdateReady();
      },
      onFinishProgress() {
        currentVersion && setLatestVersion(currentVersion);
      }
    });
  };

  const handleUpdateReady = () => {
    setIsDownloading(false);
    setDownloadProgress(1);
  };

  const applyUpdate = () => {
    hotUpdate.git.setConfig(BUNDLE_CONFIG.path);
    hotUpdate.resetApp()
  };

  const closeUpdateModal = () => {
    if (updateMeta.force) return;
  };

  const handleRefreshToken = async () => {
    const currentRefreshToken =
      useAuthorStore.getState().resLogin?.AuthenticationResult?.RefreshToken;

    if (!currentRefreshToken) {
      httpClient.setAuthorizationHeader('');
      setIsAuthorized(false);
      if (intervalId.current) clearInterval(intervalId.current);
      return;
    }
    try {
      const resRefresh = await awsService.refreshToken(currentRefreshToken);
      httpClient.setAuthorizationHeader(
        resRefresh.AuthenticationResult?.AccessToken || '',
      );
      const newAuthResult = {
        ...resRefresh.AuthenticationResult,
        RefreshToken: currentRefreshToken,
      };
      const newResLogin = {
        ...resRefresh,
        AuthenticationResult: newAuthResult,
      };
      setResLogin(newResLogin as InitiateAuthResponse);
    } catch (error) {
      setIsAuthorized(false);
      if (intervalId.current) clearInterval(intervalId.current);
    }
  };

  useEffect(() => {
    hotUpdate.git.setConfig(BUNDLE_CONFIG.path);
    const bootstrapApp = async () => {
      if (_hasHydrated) {
        try {
          await handleRefreshToken();
          checkServerVersion();
        } catch (error) {
        } finally {
          setIsChecking(false);
        }
      }
    };
    bootstrapApp();
  }, [_hasHydrated]);

  useEffect(() => {
    const isUserAuthorized = !isEmpty(resLogin?.AuthenticationResult?.IdToken);
    if (isUserAuthorized) {
      intervalId.current = setInterval(handleRefreshToken, REFRESH_INTERVAL);
    }
    return () => {
      if (intervalId.current) {
        clearInterval(intervalId.current);
      }
    };
  }, [resLogin]);

  useEffect(() => {
    if (!isChecking) {
      SplashScreen?.hide();
    }
  }, [isChecking]);

  if (isChecking) {
    return <Image style={styles.splash} source={BgSplash} />;
  }

  return (
    <ApplicationProvider customMapping={mapping as any} {...eva} theme={customTheme}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardProvider>
          <AppNavigation />
          <Modal
            visible={updateModalVisible}
            backdropStyle={styles.backdrop}
            onBackdropPress={closeUpdateModal}>
            <Card disabled={true} style={styles.card}>
              <TextCM style={{ marginBottom: 10 }}>
                {hasNewUpdate ? infoUpdate?.title :
                  isDownloading ? '⏳ Đang tải cập nhật...' :
                    '✅ Cập nhật hoàn tất'}
              </TextCM>

              {/* TRẠNG THÁI 1: Chờ người dùng xác nhận */}
              {hasNewUpdate && (
                <View>
                  <TextCM>{infoUpdate?.message}</TextCM>
                  <View style={styles.footerContainer}>
                    <Button
                      size='small'
                      onPress={startUpdateProcess}
                    >
                      CẬP NHẬT NGAY
                    </Button>
                  </View>
                </View>
              )}
              {isDownloading && (
                <View>
                  <TextCM style={{ marginBottom: 10 }}>Vui lòng giữ ứng dụng mở</TextCM>
                  <View style={styles.progressBarBg}>
                    <View style={[styles.progressBarFill, { width: `${downloadProgress * 100}%` }]} />
                  </View>
                  <TextCM style={{ textAlign: 'right', marginTop: 5 }}>
                    {(downloadProgress * 100).toFixed(0)}%
                  </TextCM>
                </View>
              )}
            </Card>
          </Modal>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </ApplicationProvider>
  );
}

const styles = StyleSheet.create({
  splash: { width: '100%', height: '100%', resizeMode: 'cover' },
  backdrop: { backgroundColor: 'rgba(0, 0, 0, 0.5)' },
  card: { padding: 10, width: 320, borderRadius: 12 },
  footerContainer: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 20 },
  footerControl: { marginHorizontal: 5 },
  progressBarBg: { height: 6, backgroundColor: '#eee', borderRadius: 3, width: '100%', overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: '#3366FF' }
});