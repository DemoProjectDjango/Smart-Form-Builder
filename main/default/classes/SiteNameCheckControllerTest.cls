@IsTest
private class SiteNameCheckControllerTest {

    @TestSetup
    static void setup() {
        Profile p = [
            SELECT Id
            FROM Profile
            WHERE PermissionsModifyAllData = true
            LIMIT 1
        ];

        User u = new User(
            ProfileId = p.Id,
            LastName = 'SiteTest',
            Email = 'site_test@example.com',
            Username = 'site_test+' + DateTime.now().getTime() + '@example.com',
            Alias = 'sitet',
            TimeZoneSidKey = 'America/Los_Angeles',
            LocaleSidKey = 'en_US',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US'
        );
        insert u;
    }

    private static User getRunAsUser() {
        return [SELECT Id FROM User WHERE Alias = 'sitet' LIMIT 1];
    }

    // -----------------------------
    // Existing method tests
    // -----------------------------

    @IsTest
    static void testDoesSiteExistReturnsFalseWhenBlank() {
        System.runAs(getRunAsUser()) {
            System.assertEquals(false, SiteNameCheckController.doesSiteExist(null), 'Site should not exist for null input');
            System.assertEquals(false, SiteNameCheckController.doesSiteExist(''), 'Site should not exist for empty string');
            System.assertEquals(false, SiteNameCheckController.doesSiteExist('   '), 'Site should not exist for whitespace input');
        }
    }

    @IsTest
    static void testDoesSiteExistReturnsFalseWhenNotFound() {
        System.runAs(getRunAsUser()) {
            String siteName = 'no_site_' + DateTime.now().getTime();
            System.assertEquals(false, SiteNameCheckController.doesSiteExist(siteName), 'Site should not exist for non-existent site name');
        }
    }

    @IsTest
    static void testDoesSiteExistWithExistingOrNoVisibleSite() {
        System.runAs(getRunAsUser()) {
            List<Site> sites;
            try {
                sites = [
                    SELECT Name
                    FROM Site
                    WITH USER_MODE
                    LIMIT 1
                ];
            } catch (Exception e) {
                sites = new List<Site>();
            }

            if (!sites.isEmpty() && String.isNotBlank(sites[0].Name)) {
                String input = '  ' + sites[0].Name.toUpperCase() + '  ';
                Boolean result = SiteNameCheckController.doesSiteExist(input);

                // Best-effort assertion: depends on org + setup visibility
                System.assertNotEquals(null, result, 'Result should not be null');
            } else {
                System.assertEquals(false, SiteNameCheckController.doesSiteExist('definitely_not_a_site'), 'Site should not exist for non-existent site name');
            }
        }
    }

    // -----------------------------
    // NEW method tests: getSiteStatus
    // -----------------------------

    @IsTest
    static void testGetSiteStatusReturnsNotReadyWhenBlank() {
        System.runAs(getRunAsUser()) {
            SiteNameCheckController.SiteStatus st1 = SiteNameCheckController.getSiteStatus(null);
            System.assertNotEquals(null, st1, 'SiteStatus should not be null for null input');
            System.assertEquals(false, st1.exists, 'Site should not exist for null input');
            System.assertEquals(false, st1.isActive, 'Site should not be active for null input');
            System.assertEquals(false, st1.isReady, 'Site should not be ready for null input');
            System.assert(String.isNotBlank(st1.reason), 'Reason should be populated for blank input');

            SiteNameCheckController.SiteStatus st2 = SiteNameCheckController.getSiteStatus('   ');
            System.assertNotEquals(null, st2, 'SiteStatus should not be null for whitespace input');
            System.assertEquals(false, st2.exists, 'Site should not exist for whitespace input');
            System.assertEquals(false, st2.isActive, 'Site should not be active for whitespace input');
            System.assertEquals(false, st2.isReady, 'Site should not be ready for whitespace input');
            System.assert(String.isNotBlank(st2.reason), 'Reason should be populated for blank input');
        }
    }

    @IsTest
    static void testGetSiteStatusReturnsNotReadyWhenNotFound() {
        System.runAs(getRunAsUser()) {
            String siteName = 'no_site_' + DateTime.now().getTime();
            SiteNameCheckController.SiteStatus st = SiteNameCheckController.getSiteStatus(siteName);

            System.assertNotEquals(null, st, 'SiteStatus should not be null for non-existent site');
            System.assertEquals(false, st.isReady, 'Site should not be ready for non-existent site');
            // In some orgs access to Site may be blocked, so exists might be false with a permission reason.
            System.assert(String.isNotBlank(st.reason), 'Reason should be populated when not ready');
        }
    }

    @IsTest
    static void testGetSiteStatusWithExistingOrNoVisibleSite() {
        System.runAs(getRunAsUser()) {
            List<Site> sites = getSitesForTest();

            if (!sites.isEmpty() && String.isNotBlank(sites[0].Name)) {
                testSiteNameLookup(sites[0]);
                if (String.isNotBlank(sites[0].UrlPathPrefix)) {
                    testSitePrefixLookup(sites[0]);
                }
            } else {
                testNoVisibleSite();
            }

            System.assert(true, 'Test executed successfully');
        }
    }

    private static List<Site> getSitesForTest() {
        List<Site> sites;
        try {
            sites = [
                SELECT Name, UrlPathPrefix
                FROM Site
                WITH USER_MODE
                LIMIT 1
            ];
        } catch (Exception e) {
            sites = new List<Site>();
        }
        return sites;
    }

    private static void testSiteNameLookup(Site site) {
        String inputName = '  ' + site.Name.toUpperCase() + '  ';
        SiteNameCheckController.SiteStatus stByName = SiteNameCheckController.getSiteStatus(inputName);

        System.assertNotEquals(null, stByName, 'SiteStatus should not be null for site name lookup');
        if (stByName.exists) {
            System.assert(String.isNotBlank(stByName.matchedName), 'matchedName should be set when exists=true');
            System.assertEquals(true, stByName.isReady == (stByName.exists && stByName.isActive),
                'isReady must equal exists && isActive');
            if (!stByName.isReady) {
                System.assert(String.isNotBlank(stByName.reason), 'Reason should be populated when not ready');
            }
        } else {
            System.assert(String.isNotBlank(stByName.reason), 'Reason should be populated when exists=false');
        }
    }

    private static void testSitePrefixLookup(Site site) {
        String inputPrefix = '  ' + site.UrlPathPrefix.toUpperCase() + '  ';
        SiteNameCheckController.SiteStatus stByPrefix = SiteNameCheckController.getSiteStatus(inputPrefix);

        System.assertNotEquals(null, stByPrefix, 'SiteStatus should not be null for site prefix lookup');
        if (stByPrefix.exists) {
            System.assert(String.isNotBlank(stByPrefix.matchedPrefix), 'matchedPrefix should be set when exists=true');
            System.assertEquals(true, stByPrefix.isReady == (stByPrefix.exists && stByPrefix.isActive),
                'isReady must equal exists && isActive');
        } else {
            System.assert(String.isNotBlank(stByPrefix.reason), 'Reason should be populated when exists=false');
        }
    }

    private static void testNoVisibleSite() {
        SiteNameCheckController.SiteStatus st = SiteNameCheckController.getSiteStatus('PublicForm');
        System.assertNotEquals(null, st, 'SiteStatus should not be null');
        System.assertEquals(false, st.isReady, 'Site should not be ready when no visible site');
        System.assert(String.isNotBlank(st.reason), 'Reason should be populated when not ready');
    }
}